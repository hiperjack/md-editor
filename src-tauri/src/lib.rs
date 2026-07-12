use std::collections::HashMap;
use std::sync::Mutex;
use tauri::Manager;

mod assoc;
mod chat;
mod commands;
mod i18n;
mod recent;
mod startup;
mod tabwin;
mod usage;

pub struct PendingPath(pub Mutex<Option<String>>);
pub struct FrontendReady(pub Mutex<bool>);

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_single_instance::init(|app, args, _cwd| {
            // 2回目起動時の引数を処理
            startup::handle_argv(app, args);
            // ウィンドウを前面へ
            if let Some(win) = app.get_webview_window("main") {
                let _ = win.unminimize();
                let _ = win.show();
                let _ = win.set_focus();
            }
        }))
        .manage(PendingPath(Mutex::new(None)))
        .manage(FrontendReady(Mutex::new(false)))
        .manage(recent::RecentFiles(Mutex::new(Vec::new())))
        .manage(recent::RecentVisible(Mutex::new(true)))
        .manage(i18n::LangState(Mutex::new(i18n::Lang::Ja)))
        .manage(tabwin::PendingTabs(Mutex::new(HashMap::new())))
        .manage(tabwin::TabBarRects(Mutex::new(HashMap::new())))
        .manage(tabwin::DragHover(Mutex::new(None)))
        .manage(tabwin::LastFocused(Mutex::new(Some("main".to_string()))))
        .manage(tabwin::OpenFiles(Mutex::new(HashMap::new())))
        .manage(chat::ChatState::default())
        .invoke_handler(tauri::generate_handler![
            commands::read_file,
            commands::write_file,
            commands::read_file_base64,
            commands::write_file_base64,
            commands::load_settings,
            commands::save_settings,
            commands::frontend_ready,
            commands::add_recent_file,
            commands::set_recent_visible,
            commands::set_lang,
            commands::list_recent_files,
            commands::open_external_url,
            commands::init_window_menu,
            chat::chat_send,
            chat::chat_cancel,
            chat::chat_check,
            usage::chat_usage,
            #[cfg(target_os = "windows")]
            assoc::query_file_associations,
            #[cfg(target_os = "windows")]
            assoc::register_file_associations,
            #[cfg(target_os = "windows")]
            assoc::unregister_file_associations,
            #[cfg(target_os = "windows")]
            assoc::open_default_apps_settings,
            tabwin::stash_pending_tab,
            tabwin::take_pending_tab,
            tabwin::register_tabbar_rect,
            tabwin::find_drop_target,
            tabwin::transfer_tab,
            tabwin::drag_over,
            tabwin::drag_end,
            tabwin::set_last_focused,
            tabwin::set_open_files,
            tabwin::find_file_window,
            tabwin::activate_file_in_window,
        ])
        .setup(|app| {
            // 最近開いたファイルをロードしてstateへ
            let initial = recent::load_initial(app.handle());
            recent::set_initial(app.handle(), initial);
            // メニューは各ウィンドウのフロント側でHTMLとして描画する
            // （ネイティブメニューは WebView2 で Alt ニーモニックが効かないため廃止）。
            // 初回起動時の引数を保留に格納
            let argv: Vec<String> = std::env::args().collect();
            startup::extract_path_to_pending(app.handle(), &argv);
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
