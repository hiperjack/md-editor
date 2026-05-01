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

#[tauri::command]
pub fn add_recent_file(app: AppHandle, path: String) -> Result<(), String> {
    let updated = crate::recent::add(&app, path);
    crate::menu::set_from_recent(&app, &updated).map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub fn set_recent_visible(app: AppHandle, show: bool) -> Result<(), String> {
    crate::recent::set_visible(&app, show);
    crate::menu::rebuild(&app).map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub fn set_lang(app: AppHandle, lang: String) -> Result<(), String> {
    crate::i18n::set(&app, crate::i18n::Lang::from_code(&lang));
    crate::menu::rebuild(&app).map_err(|e| e.to_string())?;
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
        std::process::Command::new("cmd")
            .args(["/C", "start", "", &url])
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
