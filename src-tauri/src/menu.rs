use tauri::menu::{
    AboutMetadataBuilder, Menu, MenuBuilder, MenuItem, MenuItemBuilder, PredefinedMenuItem,
    Submenu, SubmenuBuilder,
};
use tauri::{AppHandle, Emitter, Manager, WebviewWindow, Wry};

use crate::i18n;

pub fn register_handlers(app: &AppHandle<Wry>) {
    app.on_menu_event(|app, event| {
        let id = event.id().as_ref().to_string();
        if let Some(rest) = id.strip_prefix("recent_") {
            if let Ok(idx) = rest.parse::<usize>() {
                let list = crate::recent::current(app);
                if let Some(path) = list.get(idx).cloned() {
                    crate::startup::emit_open_file(app, path);
                }
            }
            return;
        }
        if id.starts_with("file_") || id.starts_with("fmt_") || id.starts_with("view_") {
            // メニューはアプリ全体に設定されているため、操作は今フォーカス中の
            // ウィンドウだけに届ける（全ウィンドウで保存等が発火しないように）。
            if let Some(win) = crate::tabwin::focused_or_main(app) {
                let _ = app.emit_to(win.label(), "menu-action", id);
            } else {
                let _ = app.emit("menu-action", id);
            }
        }
    });
}

/// 現在の最近ファイル・言語設定から新しいメニューを1つ作る。
/// メニューはウィンドウごとに個別に生成して割り当てる（HMENU を共有しない）。
/// アプリ全体で1つのメニューを共有すると、Windows では子ウィンドウを閉じた際に
/// 共有 HMENU が破棄され、残ったウィンドウのメニューが壊れるため。
fn menu_for(app: &AppHandle<Wry>) -> tauri::Result<Menu<Wry>> {
    let recent = crate::recent::current(app);
    let visible = crate::recent::is_visible(app);
    let effective: &[String] = if visible { &recent } else { &[] };
    build_menu(app, effective)
}

/// 指定ウィンドウに、そのウィンドウ専用の新しいメニューを割り当てる。
pub fn apply_to_window(app: &AppHandle<Wry>, window: &WebviewWindow<Wry>) -> tauri::Result<()> {
    let menu = menu_for(app)?;
    window.set_menu(menu)?;
    Ok(())
}

/// 全ウィンドウのメニューを作り直して割り当てる（最近ファイル・言語変更時）。
pub fn rebuild_all(app: &AppHandle<Wry>) -> tauri::Result<()> {
    for window in app.webview_windows().values() {
        let menu = menu_for(app)?;
        window.set_menu(menu)?;
    }
    Ok(())
}

fn basename(path: &str) -> String {
    std::path::Path::new(path)
        .file_name()
        .and_then(|n| n.to_str())
        .unwrap_or(path)
        .to_string()
}

fn build_menu(app: &AppHandle<Wry>, recent: &[String]) -> tauri::Result<Menu<Wry>> {
    let lang = i18n::current(app);

    let file_new = MenuItemBuilder::with_id("file_new", i18n::t(lang, "file.new"))
        .accelerator("Ctrl+N")
        .build(app)?;
    let file_open = MenuItemBuilder::with_id("file_open", i18n::t(lang, "file.open"))
        .accelerator("Ctrl+O")
        .build(app)?;
    let file_save = MenuItemBuilder::with_id("file_save", i18n::t(lang, "file.save"))
        .accelerator("Ctrl+S")
        .build(app)?;
    let file_save_as = MenuItemBuilder::with_id("file_save_as", i18n::t(lang, "file.save_as"))
        .accelerator("Ctrl+Shift+S")
        .build(app)?;
    let file_export_html =
        MenuItemBuilder::with_id("file_export_html", i18n::t(lang, "file.export_html"))
            .accelerator("Ctrl+Shift+E")
            .build(app)?;
    let file_html_preview =
        MenuItemBuilder::with_id("file_html_preview", i18n::t(lang, "file.html_preview"))
            .accelerator("Ctrl+Shift+V")
            .build(app)?;
    let file_print = MenuItemBuilder::with_id("file_print", i18n::t(lang, "file.print"))
        .accelerator("Ctrl+P")
        .build(app)?;
    let file_close = MenuItemBuilder::with_id("file_close", i18n::t(lang, "file.close"))
        .accelerator("Ctrl+W")
        .build(app)?;
    let quit_label = i18n::t(lang, "file.quit");
    let quit = PredefinedMenuItem::quit(app, Some(quit_label.as_str()))?;

    let recent_main: Vec<MenuItem<Wry>> = recent
        .iter()
        .take(5)
        .enumerate()
        .map(|(i, p)| {
            MenuItemBuilder::with_id(format!("recent_{}", i), basename(p)).build(app)
        })
        .collect::<tauri::Result<Vec<_>>>()?;

    let recent_extra: Vec<MenuItem<Wry>> = recent
        .iter()
        .enumerate()
        .skip(5)
        .map(|(i, p)| {
            MenuItemBuilder::with_id(format!("recent_{}", i), basename(p)).build(app)
        })
        .collect::<tauri::Result<Vec<_>>>()?;

    let history_submenu: Option<Submenu<Wry>> = if recent_extra.is_empty() {
        None
    } else {
        let mut sb = SubmenuBuilder::new(app, i18n::t(lang, "file.history_more"));
        for item in &recent_extra {
            sb = sb.item(item);
        }
        Some(sb.build()?)
    };

    let mut fb = SubmenuBuilder::new(app, i18n::t(lang, "menu.file"))
        .item(&file_new)
        .item(&file_open);
    if !recent_main.is_empty() {
        fb = fb.separator();
        for item in &recent_main {
            fb = fb.item(item);
        }
        if let Some(hs) = &history_submenu {
            fb = fb.item(hs);
        }
    }
    fb = fb
        .separator()
        .item(&file_save)
        .item(&file_save_as)
        .separator()
        .item(&file_export_html)
        .item(&file_html_preview)
        .item(&file_print)
        .separator()
        .item(&file_close)
        .separator()
        .item(&quit);
    let file_menu = fb.build()?;

    // OS標準の編集項目。SubmenuBuilder の .undo()/.copy() 等は既定（英語）ラベルに
    // なるため、言語に合わせたラベルを与えた PredefinedMenuItem を明示的に作る。
    let edit_undo = PredefinedMenuItem::undo(app, Some(i18n::t(lang, "edit.undo").as_str()))?;
    let edit_redo = PredefinedMenuItem::redo(app, Some(i18n::t(lang, "edit.redo").as_str()))?;
    let edit_cut = PredefinedMenuItem::cut(app, Some(i18n::t(lang, "edit.cut").as_str()))?;
    let edit_copy = PredefinedMenuItem::copy(app, Some(i18n::t(lang, "edit.copy").as_str()))?;
    let edit_paste = PredefinedMenuItem::paste(app, Some(i18n::t(lang, "edit.paste").as_str()))?;
    let edit_select_all =
        PredefinedMenuItem::select_all(app, Some(i18n::t(lang, "edit.select_all").as_str()))?;
    let edit_menu = SubmenuBuilder::new(app, i18n::t(lang, "menu.edit"))
        .item(&edit_undo)
        .item(&edit_redo)
        .separator()
        .item(&edit_cut)
        .item(&edit_copy)
        .item(&edit_paste)
        .item(&edit_select_all)
        .build()?;

    let fmt_bold = MenuItemBuilder::with_id("fmt_bold", i18n::t(lang, "fmt.bold"))
        .accelerator("Ctrl+B")
        .build(app)?;
    let fmt_italic = MenuItemBuilder::with_id("fmt_italic", i18n::t(lang, "fmt.italic"))
        .accelerator("Ctrl+I")
        .build(app)?;
    let fmt_strike = MenuItemBuilder::with_id("fmt_strike", i18n::t(lang, "fmt.strike"))
        .accelerator("Ctrl+Shift+X")
        .build(app)?;
    let fmt_code = MenuItemBuilder::with_id("fmt_code", i18n::t(lang, "fmt.code"))
        .accelerator("Ctrl+E")
        .build(app)?;
    let fmt_h1 = MenuItemBuilder::with_id("fmt_h1", i18n::t(lang, "fmt.h1"))
        .accelerator("Ctrl+Alt+1")
        .build(app)?;
    let fmt_h2 = MenuItemBuilder::with_id("fmt_h2", i18n::t(lang, "fmt.h2"))
        .accelerator("Ctrl+Alt+2")
        .build(app)?;
    let fmt_h3 = MenuItemBuilder::with_id("fmt_h3", i18n::t(lang, "fmt.h3"))
        .accelerator("Ctrl+Alt+3")
        .build(app)?;
    let fmt_quote = MenuItemBuilder::with_id("fmt_quote", i18n::t(lang, "fmt.quote")).build(app)?;
    let fmt_bullet =
        MenuItemBuilder::with_id("fmt_bullet", i18n::t(lang, "fmt.bullet")).build(app)?;
    let fmt_ordered =
        MenuItemBuilder::with_id("fmt_ordered", i18n::t(lang, "fmt.ordered")).build(app)?;
    let fmt_codeblock =
        MenuItemBuilder::with_id("fmt_codeblock", i18n::t(lang, "fmt.codeblock")).build(app)?;
    let fmt_table = MenuItemBuilder::with_id("fmt_table", i18n::t(lang, "fmt.table")).build(app)?;
    let fmt_hr = MenuItemBuilder::with_id("fmt_hr", i18n::t(lang, "fmt.hr")).build(app)?;
    let fmt_link = MenuItemBuilder::with_id("fmt_link", i18n::t(lang, "fmt.link"))
        .accelerator("Ctrl+K")
        .build(app)?;

    let format_menu = SubmenuBuilder::new(app, i18n::t(lang, "menu.format"))
        .item(&fmt_bold)
        .item(&fmt_italic)
        .item(&fmt_strike)
        .item(&fmt_code)
        .separator()
        .item(&fmt_h1)
        .item(&fmt_h2)
        .item(&fmt_h3)
        .separator()
        .item(&fmt_quote)
        .item(&fmt_bullet)
        .item(&fmt_ordered)
        .item(&fmt_codeblock)
        .item(&fmt_table)
        .item(&fmt_hr)
        .separator()
        .item(&fmt_link)
        .build()?;

    let view_zoom_in = MenuItemBuilder::with_id("view_zoom_in", i18n::t(lang, "view.zoom_in"))
        .accelerator("Ctrl+=")
        .build(app)?;
    let view_zoom_out = MenuItemBuilder::with_id("view_zoom_out", i18n::t(lang, "view.zoom_out"))
        .accelerator("Ctrl+-")
        .build(app)?;
    let view_zoom_reset =
        MenuItemBuilder::with_id("view_zoom_reset", i18n::t(lang, "view.zoom_reset"))
            .accelerator("Ctrl+0")
            .build(app)?;
    let view_font =
        MenuItemBuilder::with_id("view_font", i18n::t(lang, "view.settings")).build(app)?;

    let view_menu = SubmenuBuilder::new(app, i18n::t(lang, "menu.view"))
        .item(&view_zoom_in)
        .item(&view_zoom_out)
        .item(&view_zoom_reset)
        .separator()
        .item(&view_font)
        .build()?;

    let about_label = i18n::t(lang, "help.about");
    // バージョンは Cargo.toml (CARGO_PKG_VERSION) から取得し、ハードコードを避ける。
    let app_version = app.package_info().version.to_string();
    let about = PredefinedMenuItem::about(
        app,
        Some(about_label.as_str()),
        Some(
            AboutMetadataBuilder::new()
                .name(Some("mdedit"))
                .version(Some(app_version.as_str()))
                .build(),
        ),
    )?;

    let help_menu = SubmenuBuilder::new(app, i18n::t(lang, "menu.help"))
        .item(&about)
        .build()?;

    let menu = MenuBuilder::new(app)
        .items(&[&file_menu, &edit_menu, &format_menu, &view_menu, &help_menu])
        .build()?;

    Ok(menu)
}
