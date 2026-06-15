use std::path::Path;
use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager, State};

use crate::{FrontendReady, PendingPath};

#[derive(Serialize, Clone)]
struct OpenFilePayload {
    path: String,
    content: String,
}

/// argvからファイルらしきパスを取り出す
fn pick_file_path(argv: &[String]) -> Option<String> {
    for arg in argv.iter().skip(1) {
        if arg.starts_with("--") {
            continue;
        }
        let p = Path::new(arg);
        if p.is_file() {
            return Some(arg.clone());
        }
    }
    None
}

fn store_pending(app: &AppHandle, path: String) {
    let state: State<PendingPath> = app.state();
    let mut guard = match state.0.lock() {
        Ok(g) => g,
        Err(_) => return,
    };
    *guard = Some(path);
}

fn frontend_is_ready(app: &AppHandle) -> bool {
    let state: State<FrontendReady> = app.state();
    let ready = match state.0.lock() {
        Ok(g) => *g,
        Err(_) => false,
    };
    ready
}

pub fn extract_path_to_pending(app: &AppHandle, argv: &[String]) {
    if let Some(path) = pick_file_path(argv) {
        store_pending(app, path);
    }
}

pub fn emit_open_file(app: &AppHandle, path: String) {
    let content = match crate::commands::read_text_file(&path) {
        Ok(c) => c,
        Err(e) => {
            eprintln!("Failed to read {}: {}", path, e);
            // 履歴・関連付け起動などでファイルが見つからない/読めないとき、
            // 黙って失敗せずフロントへ通知してユーザーにメッセージを出す。
            if let Some(win) = crate::tabwin::focused_or_main(app) {
                let _ = app.emit_to(win.label(), "open-file-error", path);
            } else {
                let _ = app.emit("open-file-error", path);
            }
            return;
        }
    };
    // 外部ファイルオープンは今フォーカス中のウィンドウだけに届ける
    // （全ウィンドウで同じファイルが開かないように）。
    if let Some(win) = crate::tabwin::focused_or_main(app) {
        let _ = app.emit_to(win.label(), "open-file", OpenFilePayload { path, content });
    } else {
        let _ = app.emit("open-file", OpenFilePayload { path, content });
    }
}

/// 2回目起動時に呼ばれる
pub fn handle_argv(app: &AppHandle, argv: Vec<String>) {
    let path = match pick_file_path(&argv) {
        Some(p) => p,
        None => return,
    };

    if frontend_is_ready(app) {
        emit_open_file(app, path);
    } else {
        store_pending(app, path);
    }
}
