use std::collections::HashMap;
use std::io::{BufRead, BufReader, Read, Write};
use std::path::PathBuf;
use std::process::{Child, Command, Stdio};
use std::sync::{Arc, Mutex};
use tauri::{AppHandle, Emitter, Manager, State};

/// Claude Code CLI をチャットバックエンドとして使う。
/// 1メッセージ = 1プロセス（`claude -p`）で、会話継続は `--resume <session_id>`。
/// stdout の NDJSON はパースせず1行ずつフロントへ中継する（スキーマ変更に強くするため）。

/// ウィンドウラベル → 実行中のチャットプロセス。1ウィンドウ同時1リクエスト。
#[derive(Default)]
pub struct ChatState(pub Mutex<HashMap<String, ChatProc>>);

pub struct ChatProc {
    pid: u32,
    /// キャンセル用ハンドル。Windows は taskkill（pid）を使うため未参照になる。
    #[cfg_attr(target_os = "windows", allow(dead_code))]
    child: Arc<Mutex<Option<Child>>>,
}

#[derive(Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct ChatStreamPayload {
    req_id: u64,
    line: String,
}

#[derive(Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct ChatDonePayload {
    req_id: u64,
    code: Option<i32>,
    stderr_tail: String,
}

/// 文書の編集はディスクではなく <mdedit-proposal> マーカーの全文出力で提案させる。
/// マーカーに ``` フェンスを使わないのは、md 本文のコードフェンスと入れ子が壊れるため。
/// 注意: claude が npm の .cmd シムに解決される環境では、改行を含む引数を
/// Rust が拒否する（BatBadBut 対策）ため、このプロンプトは1行で書くこと。
const SYSTEM_PROMPT: &str = "You are an assistant embedded in a Markdown editor (mdedit). \
Each user message contains the current document between <document> tags; it includes \
unsaved edits and the latest one is the single source of truth. Rules: \
Reply in the same language as the user's message. \
You have no file, shell, or web tools; never claim to have edited any file. \
When the user asks you to modify the document, output the COMPLETE revised document verbatim, \
preceded by a line containing exactly <mdedit-proposal> and followed by a line containing \
exactly </mdedit-proposal>. \
At most one proposal per reply; keep unrelated parts of the document unchanged; \
briefly explain the changes outside the markers. \
If no document change is needed, answer normally without the markers.";

const STDERR_TAIL_MAX: usize = 8 * 1024;

#[cfg(target_os = "windows")]
const CREATE_NO_WINDOW: u32 = 0x0800_0000;

/// コンソールを出さない Command を作る（GUI アプリから子プロセスを起動するため）。
fn quiet_command(program: &std::ffi::OsStr) -> Command {
    let cmd = Command::new(program);
    #[cfg(target_os = "windows")]
    let cmd = {
        use std::os::windows::process::CommandExt;
        let mut c = cmd;
        c.creation_flags(CREATE_NO_WINDOW);
        c
    };
    cmd
}

/// claude CLI を探す。GUI アプリは PATH がシェルと異なることがあるため、
/// where/which に加えて既知のインストール先も探す。
fn find_claude() -> Option<PathBuf> {
    #[cfg(target_os = "windows")]
    let finder = ("where.exe", "claude");
    #[cfg(not(target_os = "windows"))]
    let finder = ("which", "claude");
    if let Ok(out) = quiet_command(finder.0.as_ref()).arg(finder.1).output() {
        if out.status.success() {
            if let Some(first) = String::from_utf8_lossy(&out.stdout)
                .lines()
                .map(str::trim)
                .find(|l| !l.is_empty())
            {
                return Some(PathBuf::from(first));
            }
        }
    }
    // PATH で見つからない場合の既知のインストール先
    let home = std::env::var("USERPROFILE")
        .or_else(|_| std::env::var("HOME"))
        .ok()?;
    let home = PathBuf::from(home);
    let candidates = [
        home.join(".local").join("bin").join("claude.exe"),
        home.join(".local").join("bin").join("claude"),
        home.join("AppData")
            .join("Roaming")
            .join("npm")
            .join("claude.cmd"),
    ];
    candidates.into_iter().find(|p| p.is_file())
}

/// claude CLI の実体パスを解決する。成功時のみキャッシュする
/// （「見つからない」を永続キャッシュすると、案内に従って CLI を
/// インストールした後もアプリ再起動まで復旧しないため）。
fn resolve_claude() -> Result<PathBuf, String> {
    static CACHE: Mutex<Option<PathBuf>> = Mutex::new(None);
    if let Ok(guard) = CACHE.lock() {
        if let Some(p) = guard.as_ref() {
            return Ok(p.clone());
        }
    }
    let found = find_claude().ok_or_else(|| "claude-not-found".to_string())?;
    if let Ok(mut guard) = CACHE.lock() {
        *guard = Some(found.clone());
    }
    Ok(found)
}

/// セッションファイルの保存先が cwd 由来のため、cwd はホームに固定する
/// （メッセージごとに cwd が変わると --resume が壊れる）。
fn chat_cwd(app: &AppHandle) -> Option<PathBuf> {
    app.path().home_dir().ok().or_else(|| {
        std::env::var("USERPROFILE")
            .or_else(|_| std::env::var("HOME"))
            .ok()
            .map(PathBuf::from)
    })
}

/// claude CLI にメッセージを送る。プロンプトは stdin 渡し
/// （Windows のコマンドライン長制限とエスケープ問題を回避）。
/// 応答は "chat-stream"（NDJSON 1行ずつ）→ "chat-done" でウィンドウへ emit する。
#[tauri::command]
pub async fn chat_send(
    app: AppHandle,
    window: tauri::Window,
    state: State<'_, ChatState>,
    req_id: u64,
    prompt: String,
    session_id: Option<String>,
) -> Result<(), String> {
    let claude = resolve_claude()?;
    let label = window.label().to_string();

    let mut cmd = quiet_command(claude.as_os_str());
    cmd.args([
        "-p",
        "--verbose",
        "--output-format",
        "stream-json",
        "--include-partial-messages",
        // ディスク編集をさせない: 全ビルトインツール無効 + MCP/ユーザー設定を読まない
        "--tools",
        "",
        "--strict-mcp-config",
        "--setting-sources",
        "",
        "--append-system-prompt",
        SYSTEM_PROMPT,
    ]);
    if let Some(sid) = session_id.as_deref() {
        if !sid.is_empty() {
            cmd.args(["--resume", sid]);
        }
    }
    if let Some(cwd) = chat_cwd(&app) {
        cmd.current_dir(cwd);
    }
    // サブスク認証（~/.claude の資格情報）を確実に使う。API キーは参照させない。
    cmd.env_remove("ANTHROPIC_API_KEY");
    cmd.stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());

    // 実行中チェックと spawn をロック内で行い、二重起動を防ぐ
    let mut procs = state.0.lock().map_err(|e| format!("ChatState lock: {}", e))?;
    if procs.contains_key(&label) {
        return Err("busy".to_string());
    }
    let mut child = cmd.spawn().map_err(|e| format!("spawn claude: {}", e))?;
    let pid = child.id();
    let stdin = child.stdin.take();
    let stdout = child.stdout.take();
    let stderr = child.stderr.take();
    let child = Arc::new(Mutex::new(Some(child)));
    procs.insert(
        label.clone(),
        ChatProc {
            pid,
            child: Arc::clone(&child),
        },
    );
    drop(procs);

    // stdin ライター（リーダーと並行に書く: パイプ詰まりのデッドロック回避）
    std::thread::spawn(move || {
        if let Some(mut stdin) = stdin {
            let _ = stdin.write_all(prompt.as_bytes());
            // drop で stdin がクローズされ、CLI が入力終端を検知する
        }
    });

    // stderr リーダー。読みながら末尾 STDERR_TAIL_MAX バイトだけ保持する
    // （read_to_string で全量をためると、CLI の異常出力でメモリを食い潰すため）。
    let stderr_tail = Arc::new(Mutex::new(String::new()));
    let stderr_handle = {
        let tail = Arc::clone(&stderr_tail);
        std::thread::spawn(move || {
            if let Some(mut stderr) = stderr {
                let mut buf: Vec<u8> = Vec::new();
                let mut chunk = [0u8; 4096];
                loop {
                    match stderr.read(&mut chunk) {
                        Ok(0) | Err(_) => break,
                        Ok(n) => {
                            buf.extend_from_slice(&chunk[..n]);
                            if buf.len() > STDERR_TAIL_MAX {
                                let cut = buf.len() - STDERR_TAIL_MAX;
                                buf.drain(..cut);
                            }
                        }
                    }
                }
                // 途中で切れたUTF-8境界は from_utf8_lossy が置換文字で吸収する
                let text = String::from_utf8_lossy(&buf).into_owned();
                if let Ok(mut t) = tail.lock() {
                    *t = text;
                }
            }
        })
    };

    // stdout リーダー: 1行ずつ中継し、EOF 後に後始末して chat-done を送る
    std::thread::spawn(move || {
        if let Some(stdout) = stdout {
            let reader = BufReader::new(stdout);
            for line in reader.lines() {
                let Ok(line) = line else { break };
                if line.trim().is_empty() {
                    continue;
                }
                let _ = app.emit_to(&label, "chat-stream", ChatStreamPayload { req_id, line });
            }
        }
        let _ = stderr_handle.join();
        let code = child
            .lock()
            .ok()
            .and_then(|mut c| c.take())
            .and_then(|mut c| c.wait().ok())
            .and_then(|s| s.code());
        {
            let state: State<ChatState> = app.state();
            if let Ok(mut procs) = state.0.lock() {
                procs.remove(&label);
            };
        }
        let stderr_tail = stderr_tail.lock().map(|t| t.clone()).unwrap_or_default();
        let _ = app.emit_to(
            &label,
            "chat-done",
            ChatDonePayload {
                req_id,
                code,
                stderr_tail,
            },
        );
    });

    Ok(())
}

/// 実行中のチャットプロセスを停止する。後始末と chat-done は
/// stdout リーダーの EOF 検知に任せる。
#[tauri::command]
pub fn chat_cancel(window: tauri::Window, state: State<'_, ChatState>) -> Result<(), String> {
    let label = window.label().to_string();
    let procs = state.0.lock().map_err(|e| format!("ChatState lock: {}", e))?;
    let Some(proc) = procs.get(&label) else {
        return Ok(()); // 既に終了済み
    };
    #[cfg(target_os = "windows")]
    {
        // .cmd シム経由でも確実に止めるためプロセスツリーごと落とす
        let _ = quiet_command("taskkill".as_ref())
            .args(["/T", "/F", "/PID", &proc.pid.to_string()])
            .output();
    }
    #[cfg(not(target_os = "windows"))]
    {
        if let Ok(mut child) = proc.child.lock() {
            if let Some(c) = child.as_mut() {
                let _ = c.kill();
            }
        }
    }
    Ok(())
}

/// claude CLI が使えるか確認し、バージョン文字列を返す（未インストール検出用）。
#[tauri::command]
pub async fn chat_check() -> Result<String, String> {
    let claude = resolve_claude()?;
    let out = quiet_command(claude.as_os_str())
        .arg("--version")
        .output()
        .map_err(|e| format!("run claude --version: {}", e))?;
    if !out.status.success() {
        return Err(format!(
            "claude --version failed: {}",
            String::from_utf8_lossy(&out.stderr).trim()
        ));
    }
    Ok(String::from_utf8_lossy(&out.stdout).trim().to_string())
}
