use std::io::Write;
use std::process::Stdio;
use tauri::{AppHandle, Manager};

/// Claudeサブスクの使用量（5h/7dレートリミット等）を OAuth usage エンドポイント
/// から取得する。HTTPクライアントは OS 標準の curl（依存クレートを増やさない。
/// Windows 10 1803+ / macOS は標準搭載）。レスポンス JSON はパースせず文字列の
/// ままフロントへ返す（chat-stream と同じ「スキーマ変更に強くする」方針）。
/// トークンは stdin 経由の curl 設定（--config -）で渡し、プロセス一覧・ログに
/// 出さない。期限切れ時の自前リフレッシュはしない（Claude Code 本体または
/// チャット実行が更新するため、フロントは案内文言を出すだけでよい）。

const USAGE_URL: &str = "https://api.anthropic.com/api/oauth/usage";

/// ~/.claude/.credentials.json の中身から OAuth アクセストークンを取り出す。
fn extract_token(raw: &str) -> Option<String> {
    let v: serde_json::Value = serde_json::from_str(raw).ok()?;
    let t = v.get("claudeAiOauth")?.get("accessToken")?.as_str()?;
    if t.is_empty() {
        None
    } else {
        Some(t.to_string())
    }
}

/// curl 出力（本文 + "\n" + HTTPステータスコード）を分離する。
/// -w "\n%{http_code}" で本文の後ろにステータスを付けている前提。
fn split_body_status(out: &str) -> (String, u32) {
    match out.trim_end().rsplit_once('\n') {
        Some((body, code)) => (body.to_string(), code.trim().parse().unwrap_or(0)),
        None => (String::new(), out.trim().parse().unwrap_or(0)),
    }
}

#[tauri::command]
pub async fn chat_usage(app: AppHandle) -> Result<String, String> {
    let home = app
        .path()
        .home_dir()
        .map_err(|_| "no-credentials".to_string())?;
    let cred = std::fs::read_to_string(home.join(".claude").join(".credentials.json"))
        .map_err(|_| "no-credentials".to_string())?;
    let token = extract_token(&cred).ok_or_else(|| "no-credentials".to_string())?;
    // プロセス起動＋待機はブロッキングなので async ランタイムから逃がす
    tauri::async_runtime::spawn_blocking(move || fetch_usage(&token))
        .await
        .map_err(|e| format!("task join: {e}"))?
}

fn fetch_usage(token: &str) -> Result<String, String> {
    let mut child = crate::chat::quiet_command("curl".as_ref())
        .args([
            "-sS",
            "--max-time",
            "15",
            "--config",
            "-", // ヘッダー（トークン）は stdin の設定で渡す
            "-w",
            "\n%{http_code}", // --fail-with-body は古い curl に無いためステータス後置で判定
            USAGE_URL,
        ])
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| format!("spawn curl: {e}"))?;
    if let Some(mut stdin) = child.stdin.take() {
        let cfg = format!(
            "header = \"Authorization: Bearer {token}\"\nheader = \"anthropic-beta: oauth-2025-04-20\"\n"
        );
        stdin
            .write_all(cfg.as_bytes())
            .map_err(|e| format!("curl stdin: {e}"))?;
        // drop で stdin がクローズされ、curl が設定終端を検知する
    }
    let out = child
        .wait_with_output()
        .map_err(|e| format!("curl: {e}"))?;
    if !out.status.success() {
        // -sS の stderr はエラー概要のみでトークンは含まれない
        return Err(format!(
            "network: {}",
            String::from_utf8_lossy(&out.stderr).trim()
        ));
    }
    let (body, code) = split_body_status(&String::from_utf8_lossy(&out.stdout));
    match code {
        200 => Ok(body),
        401 | 403 => Err("unauthorized".to_string()),
        c => Err(format!("http-{c}")),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn extract_token_ok() {
        let raw = r#"{"claudeAiOauth":{"accessToken":"sk-ant-oat01-xxx","expiresAt":1}}"#;
        assert_eq!(extract_token(raw).as_deref(), Some("sk-ant-oat01-xxx"));
    }

    #[test]
    fn extract_token_missing_or_empty() {
        assert_eq!(extract_token(r#"{}"#), None);
        assert_eq!(
            extract_token(r#"{"claudeAiOauth":{"accessToken":""}}"#),
            None
        );
        assert_eq!(extract_token("not json"), None);
    }

    #[test]
    fn split_body_status_normal() {
        let (body, code) = split_body_status("{\"five_hour\":{}}\n200");
        assert_eq!(body, "{\"five_hour\":{}}");
        assert_eq!(code, 200);
    }

    #[test]
    fn split_body_status_empty_body() {
        // 401 などで本文が空のケース: 出力は "\n401"
        let (body, code) = split_body_status("\n401");
        assert_eq!(body, "");
        assert_eq!(code, 401);
    }
}
