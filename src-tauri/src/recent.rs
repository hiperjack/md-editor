use std::fs;
use std::path::PathBuf;
use std::sync::Mutex;
use tauri::{AppHandle, Manager, State};

const FILENAME: &str = "recent.json";
const MAX: usize = 30;

pub struct RecentFiles(pub Mutex<Vec<String>>);
pub struct RecentVisible(pub Mutex<bool>);

fn data_path(app: &AppHandle) -> Option<PathBuf> {
    let dir = app.path().app_data_dir().ok()?;
    if !dir.exists() {
        let _ = fs::create_dir_all(&dir);
    }
    Some(dir.join(FILENAME))
}

pub fn load_initial(app: &AppHandle) -> Vec<String> {
    let p = match data_path(app) {
        Some(p) => p,
        None => return Vec::new(),
    };
    let s = match fs::read_to_string(&p) {
        Ok(s) => s,
        Err(_) => return Vec::new(),
    };
    serde_json::from_str(&s).unwrap_or_default()
}

fn persist(app: &AppHandle, list: &[String]) {
    let p = match data_path(app) {
        Some(p) => p,
        None => return,
    };
    if let Ok(s) = serde_json::to_string(list) {
        let _ = fs::write(&p, s);
    }
}

pub fn current(app: &AppHandle) -> Vec<String> {
    let state: State<RecentFiles> = app.state();
    let guard = state.0.lock();
    let result = match guard {
        Ok(g) => g.clone(),
        Err(_) => Vec::new(),
    };
    result
}

pub fn set_initial(app: &AppHandle, list: Vec<String>) {
    let state: State<RecentFiles> = app.state();
    let guard = state.0.lock();
    if let Ok(mut g) = guard {
        *g = list;
    }
}

// 旧ネイティブメニューの最近ファイル表示判定に使っていた。
// 現在は表示可否をフロント側の設定で扱うため未使用だが、念のため残す。
#[allow(dead_code)]
pub fn is_visible(app: &AppHandle) -> bool {
    let state: State<RecentVisible> = app.state();
    let guard = state.0.lock();
    match guard {
        Ok(g) => *g,
        Err(_) => true,
    }
}

pub fn set_visible(app: &AppHandle, show: bool) {
    let state: State<RecentVisible> = app.state();
    let guard = state.0.lock();
    if let Ok(mut g) = guard {
        *g = show;
    }
}

/// path をリストから削除して永続化（メニューの個別削除用）。
pub fn remove(app: &AppHandle, path: &str) {
    let snapshot = {
        let state: State<RecentFiles> = app.state();
        let mut list = match state.0.lock() {
            Ok(g) => g,
            Err(_) => return,
        };
        list.retain(|x| x != path);
        list.clone()
    };
    persist(app, &snapshot);
}

/// path をリスト先頭に追加（既存があれば移動）。最大30件。
/// 永続化＋更新後リストを返す。
pub fn add(app: &AppHandle, path: String) -> Vec<String> {
    let snapshot = {
        let state: State<RecentFiles> = app.state();
        let mut list = match state.0.lock() {
            Ok(g) => g,
            Err(_) => return Vec::new(),
        };
        list.retain(|x| x != &path);
        list.insert(0, path);
        if list.len() > MAX {
            list.truncate(MAX);
        }
        list.clone()
    };
    persist(app, &snapshot);
    snapshot
}
