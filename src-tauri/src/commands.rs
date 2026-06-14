use std::fs;
use std::path::Path;
use tauri::{AppHandle, Manager, State};

use crate::{FrontendReady, PendingPath};

#[tauri::command]
pub fn read_file(path: String) -> Result<String, String> {
    fs::read_to_string(&path).map_err(|e| format!("read_file({}): {}", path, e))
}

#[tauri::command]
pub fn write_file(path: String, content: String) -> Result<(), String> {
    if let Some(parent) = Path::new(&path).parent() {
        if !parent.as_os_str().is_empty() {
            fs::create_dir_all(parent).map_err(|e| format!("create dir: {}", e))?;
        }
    }
    fs::write(&path, content).map_err(|e| format!("write_file({}): {}", path, e))
}

/// 文書テーマ設定の保存先（{appDataDir}/settings.json）。
fn settings_path(app: &AppHandle) -> Result<std::path::PathBuf, String> {
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("app_data_dir: {}", e))?;
    Ok(dir.join("settings.json"))
}

#[tauri::command]
pub fn load_settings(app: AppHandle) -> Result<Option<String>, String> {
    let path = settings_path(&app)?;
    if !path.exists() {
        return Ok(None);
    }
    fs::read_to_string(&path)
        .map(Some)
        .map_err(|e| format!("load_settings: {}", e))
}

#[tauri::command]
pub fn save_settings(app: AppHandle, json: String) -> Result<(), String> {
    let path = settings_path(&app)?;
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|e| format!("create dir: {}", e))?;
    }
    fs::write(&path, json).map_err(|e| format!("save_settings: {}", e))
}

/// 依存最小方針のため base64 は自前実装（標準アルファベット・パディングあり）。
fn base64_encode(data: &[u8]) -> String {
    const TABLE: &[u8; 64] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    let mut out = String::with_capacity(data.len().div_ceil(3) * 4);
    for chunk in data.chunks(3) {
        let b0 = chunk[0] as u32;
        let b1 = u32::from(*chunk.get(1).unwrap_or(&0));
        let b2 = u32::from(*chunk.get(2).unwrap_or(&0));
        let n = (b0 << 16) | (b1 << 8) | b2;
        out.push(TABLE[((n >> 18) & 63) as usize] as char);
        out.push(TABLE[((n >> 12) & 63) as usize] as char);
        out.push(if chunk.len() > 1 {
            TABLE[((n >> 6) & 63) as usize] as char
        } else {
            '='
        });
        out.push(if chunk.len() > 2 {
            TABLE[(n & 63) as usize] as char
        } else {
            '='
        });
    }
    out
}

/// HTML出力時のローカル画像埋め込み（data URI化）用。
#[tauri::command]
pub fn read_file_base64(path: String) -> Result<String, String> {
    let bytes = fs::read(&path).map_err(|e| format!("read_file_base64({}): {}", path, e))?;
    Ok(base64_encode(&bytes))
}

#[tauri::command]
pub fn add_recent_file(app: AppHandle, path: String) -> Result<(), String> {
    crate::recent::add(&app, path);
    Ok(())
}

#[tauri::command]
pub fn set_recent_visible(app: AppHandle, show: bool) -> Result<(), String> {
    crate::recent::set_visible(&app, show);
    Ok(())
}

#[tauri::command]
pub fn set_lang(app: AppHandle, lang: String) -> Result<(), String> {
    crate::i18n::set(&app, crate::i18n::Lang::from_code(&lang));
    Ok(())
}

/// 最近開いたファイルの一覧を返す（HTMLメニューバーのファイルメニュー用）。
#[tauri::command]
pub fn list_recent_files(app: AppHandle) -> Vec<String> {
    crate::recent::current(&app)
}

/// 旧: ネイティブメニュー割り当て。メニューはHTMLで描画するため何もしない。
#[tauri::command]
pub fn init_window_menu() -> Result<(), String> {
    Ok(())
}

#[tauri::command]
pub fn open_external_url(url: String) -> Result<(), String> {
    // 既定ブラウザで開く対象は http/https のみに限定する。
    // file:/javascript:/その他スキームは拒否（任意コマンド実行回避）。
    let lower = url.to_ascii_lowercase();
    if !(lower.starts_with("http://") || lower.starts_with("https://")) {
        return Err(format!("unsupported url scheme: {}", url));
    }
    // URL に制御文字や改行が含まれていたら拒否。
    if url.chars().any(|c| c.is_control()) {
        return Err("url contains control characters".to_string());
    }

    #[cfg(target_os = "windows")]
    {
        // `start` は cmd.exe の組み込みコマンドのため、cmd 経由で起動する。
        // 第1引数の "" はウィンドウタイトル（URL を誤ってタイトルとして消費させない）。
        // CREATE_NO_WINDOW で cmd.exe のコンソールが一瞬チラつくのを抑止。
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        std::process::Command::new("cmd")
            .args(["/C", "start", "", &url])
            .creation_flags(CREATE_NO_WINDOW)
            .spawn()
            .map_err(|e| format!("spawn start: {}", e))?;
    }
    #[cfg(target_os = "macos")]
    {
        std::process::Command::new("open")
            .arg(&url)
            .spawn()
            .map_err(|e| format!("spawn open: {}", e))?;
    }
    #[cfg(all(unix, not(target_os = "macos")))]
    {
        std::process::Command::new("xdg-open")
            .arg(&url)
            .spawn()
            .map_err(|e| format!("spawn xdg-open: {}", e))?;
    }
    Ok(())
}

#[tauri::command]
pub fn frontend_ready(app: AppHandle) -> Result<(), String> {
    {
        let state: State<FrontendReady> = app.state();
        let mut ready = state
            .0
            .lock()
            .map_err(|e| format!("FrontendReady lock: {}", e))?;
        *ready = true;
    }
    let pending = {
        let state: State<PendingPath> = app.state();
        let mut guard = state
            .0
            .lock()
            .map_err(|e| format!("PendingPath lock: {}", e))?;
        guard.take()
    };
    if let Some(path) = pending {
        crate::startup::emit_open_file(&app, path);
    }
    Ok(())
}
