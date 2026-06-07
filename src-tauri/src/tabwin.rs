//! タブの新規ウィンドウ化（切り離し）まわり。
//!
//! ウィンドウ生成自体はフロント側の `WebviewWindow` API（Tauri 内部の正規経路）で行う。
//! Rust 側は移送するタブ内容の受け渡しだけを担当する:
//!  - `stash_pending_tab` : 移送元が、生成予定ウィンドウのラベルで内容を退避する。
//!  - `take_pending_tab`   : 新ウィンドウが起動時に自分のラベル宛ての内容を取り出す。
//!
//! 注: Windows では Rust コマンド内で `WebviewWindowBuilder::build()` を呼ぶと
//! 2枚目のウィンドウが白画面/フリーズする既知の問題があるため、生成はフロントに委ねる。

use std::collections::HashMap;
use std::sync::Mutex;

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager, State, WebviewWindow, Wry};

/// ウィンドウ間で移送するタブの内容。
#[derive(Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct TabPayload {
    /// ファイルパス（未保存タブは None）。
    pub file_path: Option<String>,
    /// 現在の表示内容（未保存分込み）。
    pub content: String,
    /// 移送元エディタの baseline（正規化済みのディスク内容）。dirty 判定の基準。
    pub baseline: String,
    /// 直近のディスク内容（外部変更検知用）。
    pub disk_content: String,
}

/// ラベル → 移送待ちタブ内容。
pub struct PendingTabs(pub Mutex<HashMap<String, TabPayload>>);

/// フォーカス中のウィンドウを返す。無ければ "main"、それも無ければ任意の1つ。
/// メニュー操作・外部ファイルオープンを「今操作しているウィンドウ」だけに届けるために使う。
pub fn focused_or_main(app: &AppHandle<Wry>) -> Option<WebviewWindow<Wry>> {
    let windows = app.webview_windows();
    for w in windows.values() {
        if w.is_focused().unwrap_or(false) {
            return Some(w.clone());
        }
    }
    app.get_webview_window("main")
        .or_else(|| windows.values().next().cloned())
}

/// 移送するタブ内容を、これから生成するウィンドウのラベルで退避する。
#[tauri::command]
pub fn stash_pending_tab(
    label: String,
    payload: TabPayload,
    state: State<PendingTabs>,
) -> Result<(), String> {
    let mut guard = state
        .0
        .lock()
        .map_err(|e| format!("PendingTabs lock: {}", e))?;
    guard.insert(label, payload);
    Ok(())
}

/// 新ウィンドウ起動時、自分のラベル宛ての移送内容を取り出す（消費して削除）。
#[tauri::command]
pub fn take_pending_tab(label: String, state: State<PendingTabs>) -> Option<TabPayload> {
    state.0.lock().ok().and_then(|mut g| g.remove(&label))
}
