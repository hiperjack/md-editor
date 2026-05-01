use std::sync::Mutex;
use tauri::Manager;

mod commands;
mod i18n;
mod menu;
mod recent;
mod startup;

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
        .invoke_handler(tauri::generate_handler![
            commands::read_file,
            commands::write_file,
            commands::frontend_ready,
            commands::add_recent_file,
            commands::set_recent_visible,
            commands::set_lang,
            commands::open_external_url,
        ])
        .setup(|app| {
            // 最近開いたファイルをロードしてstateへ
            let initial = recent::load_initial(app.handle());
            recent::set_initial(app.handle(), initial.clone());
            // メニュー：イベントハンドラ登録（一度だけ）→ 初期メニュー設定
            menu::register_handlers(app.handle());
            menu::set_from_recent(app.handle(), &initial)?;
            // 初回起動時の引数を保留に格納
            let argv: Vec<String> = std::env::args().collect();
            startup::extract_path_to_pending(app.handle(), &argv);
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
