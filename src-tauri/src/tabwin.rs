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
use tauri::{AppHandle, Emitter, Manager, State, WebviewWindow, Wry};

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

/// タブバーの画面矩形（logical px）。Phase 3 の結合先ヒットテストに使う。
#[derive(Clone, Copy)]
pub struct Rect {
    pub x: f64,
    pub y: f64,
    pub w: f64,
    pub h: f64,
}

/// ラベル → タブバー画面矩形。
pub struct TabBarRects(pub Mutex<HashMap<String, Rect>>);

/// 結合ドラッグ中、現在ホバー中の対象ウィンドウラベル（青ハイライト制御用）。
pub struct DragHover(pub Mutex<Option<String>>);

/// 直近にフォーカスされたウィンドウのラベル。
/// メニュー操作時はネイティブメニューに焦点が移り webview の is_focused が
/// 全ウィンドウ false になるため、操作対象の特定にこれを使う。
pub struct LastFocused(pub Mutex<Option<String>>);

/// ウィンドウがフォーカスを得たときにフロントから呼ぶ。
#[tauri::command]
pub fn set_last_focused(label: String, state: State<LastFocused>) -> Result<(), String> {
    let mut g = state
        .0
        .lock()
        .map_err(|e| format!("LastFocused lock: {}", e))?;
    *g = Some(label);
    Ok(())
}

/// 画面座標 (x, y) を含むタブバーを持つ実在ウィンドウを返す（source 除外）。
fn hit_test(
    app: &AppHandle<Wry>,
    rects: &HashMap<String, Rect>,
    x: f64,
    y: f64,
    source: &str,
) -> Option<String> {
    for (label, r) in rects.iter() {
        if label == source {
            continue;
        }
        if app.get_webview_window(label).is_none() {
            continue;
        }
        if x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h {
            return Some(label.clone());
        }
    }
    None
}

/// フォーカス中のウィンドウを返す。無ければ "main"、それも無ければ任意の1つ。
/// メニュー操作・外部ファイルオープンを「今操作しているウィンドウ」だけに届けるために使う。
pub fn focused_or_main(app: &AppHandle<Wry>) -> Option<WebviewWindow<Wry>> {
    let windows = app.webview_windows();
    // 1. ライブにフォーカス中のウィンドウ。
    for w in windows.values() {
        if w.is_focused().unwrap_or(false) {
            return Some(w.clone());
        }
    }
    // 2. 直近にフォーカスされたウィンドウ（メニュー操作時は webview が
    //    フォーカスを失い is_focused が false になるため、これで補う）。
    if let Some(state) = app.try_state::<LastFocused>() {
        if let Ok(g) = state.0.lock() {
            if let Some(label) = g.as_ref() {
                if let Some(w) = app.get_webview_window(label) {
                    return Some(w);
                }
            }
        }
    }
    // 3. フォールバック。
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

/// ラベル → そのウィンドウが開いているファイルパス一覧。
/// ウィンドウ間で同じファイルの二重オープンを検知するために使う。
pub struct OpenFiles(pub Mutex<HashMap<String, Vec<String>>>);

/// 各ウィンドウが自分の開いているファイルパス一覧を登録/更新する。
#[tauri::command]
pub fn set_open_files(
    label: String,
    paths: Vec<String>,
    state: State<OpenFiles>,
) -> Result<(), String> {
    let mut g = state
        .0
        .lock()
        .map_err(|e| format!("OpenFiles lock: {}", e))?;
    g.insert(label, paths);
    Ok(())
}

/// 指定パスを開いている別の実在ウィンドウのラベルを返す（source 除外）。
#[tauri::command]
pub fn find_file_window(
    app: AppHandle<Wry>,
    path: String,
    source_label: String,
    state: State<OpenFiles>,
) -> Option<String> {
    let g = state.0.lock().ok()?;
    for (label, paths) in g.iter() {
        if label == &source_label {
            continue;
        }
        if app.get_webview_window(label).is_none() {
            continue;
        }
        if paths.iter().any(|p| p == &path) {
            return Some(label.clone());
        }
    }
    None
}

/// 対象ウィンドウを前面化し、指定パスのタブをアクティブ化させる。
#[tauri::command]
pub fn activate_file_in_window(
    app: AppHandle<Wry>,
    target_label: String,
    path: String,
) -> Result<(), String> {
    if let Some(win) = app.get_webview_window(&target_label) {
        let _ = win.unminimize();
        let _ = win.set_focus();
    }
    app.emit_to(target_label.as_str(), "activate-file", path)
        .map_err(|e| e.to_string())?;
    Ok(())
}

/// 各ウィンドウが自分のタブバー画面矩形（logical px）を登録/更新する。
#[tauri::command]
pub fn register_tabbar_rect(
    label: String,
    x: f64,
    y: f64,
    w: f64,
    h: f64,
    state: State<TabBarRects>,
) -> Result<(), String> {
    let mut g = state
        .0
        .lock()
        .map_err(|e| format!("TabBarRects lock: {}", e))?;
    g.insert(label, Rect { x, y, w, h });
    Ok(())
}

/// 画面座標 (x, y) を含むタブバーを持つウィンドウのラベルを返す（source 除外）。
/// 実在しないウィンドウ（閉じた後の stale 矩形）は無視する。
#[tauri::command]
pub fn find_drop_target(
    app: AppHandle<Wry>,
    x: f64,
    y: f64,
    source_label: String,
    state: State<TabBarRects>,
) -> Option<String> {
    let g = state.0.lock().ok()?;
    hit_test(&app, &g, x, y, &source_label)
}

/// 結合ドラッグ中、対象ウィンドウに挿入位置インジケータ（青線）を出させる。
/// 対象が変わったら直前の対象には消すよう通知する。
#[tauri::command]
pub fn drag_over(
    app: AppHandle<Wry>,
    source_label: String,
    x: f64,
    y: f64,
    rects: State<TabBarRects>,
    hover: State<DragHover>,
) -> Result<(), String> {
    let target = {
        let g = rects
            .0
            .lock()
            .map_err(|e| format!("TabBarRects lock: {}", e))?;
        hit_test(&app, &g, x, y, &source_label)
    };
    let mut last = hover
        .0
        .lock()
        .map_err(|e| format!("DragHover lock: {}", e))?;
    if *last != target {
        if let Some(prev) = last.as_ref() {
            let _ = app.emit_to(prev.as_str(), "tabbar-dragleave", ());
        }
        *last = target.clone();
    }
    if let Some(t) = target.as_ref() {
        let _ = app.emit_to(t.as_str(), "tabbar-dragover", x);
    }
    Ok(())
}

/// 結合ドラッグ終了。ホバー中だった対象のインジケータを消す。
#[tauri::command]
pub fn drag_end(app: AppHandle<Wry>, hover: State<DragHover>) -> Result<(), String> {
    let mut last = hover
        .0
        .lock()
        .map_err(|e| format!("DragHover lock: {}", e))?;
    if let Some(prev) = last.take() {
        let _ = app.emit_to(prev.as_str(), "tabbar-dragleave", ());
    }
    Ok(())
}

/// 対象ウィンドウへタブを移送する。`add-moved-tab` を送って前面化する。
#[tauri::command]
pub fn transfer_tab(
    app: AppHandle<Wry>,
    target_label: String,
    payload: TabPayload,
) -> Result<(), String> {
    app.emit_to(&target_label, "add-moved-tab", payload)
        .map_err(|e| e.to_string())?;
    if let Some(win) = app.get_webview_window(&target_label) {
        let _ = win.unminimize();
        let _ = win.set_focus();
    }
    Ok(())
}
