use std::sync::Mutex;
use tauri::{AppHandle, Manager, State};

#[derive(Clone, Copy, PartialEq, Eq)]
pub enum Lang {
    Ja,
    En,
}

impl Lang {
    pub fn from_code(s: &str) -> Self {
        match s {
            "en" | "EN" | "en-US" => Lang::En,
            _ => Lang::Ja,
        }
    }
}

pub struct LangState(pub Mutex<Lang>);

pub fn current(app: &AppHandle) -> Lang {
    let state: State<LangState> = app.state();
    let guard = state.0.lock();
    match guard {
        Ok(g) => *g,
        Err(_) => Lang::Ja,
    }
}

pub fn set(app: &AppHandle, lang: Lang) {
    let state: State<LangState> = app.state();
    let guard = state.0.lock();
    if let Ok(mut g) = guard {
        *g = lang;
    }
}

pub fn t(lang: Lang, key: &str) -> String {
    use Lang::*;
    let s: &str = match (lang, key) {
        // 上位メニュー
        (Ja, "menu.file") => "ファイル",
        (En, "menu.file") => "File",
        (Ja, "menu.edit") => "編集",
        (En, "menu.edit") => "Edit",
        (Ja, "menu.format") => "書式",
        (En, "menu.format") => "Format",
        (Ja, "menu.view") => "表示",
        (En, "menu.view") => "View",
        (Ja, "menu.help") => "ヘルプ",
        (En, "menu.help") => "Help",

        // 編集（OS標準項目のラベル。日本語モードでも英語のままにならないよう明示する）
        (Ja, "edit.undo") => "元に戻す",
        (En, "edit.undo") => "Undo",
        (Ja, "edit.redo") => "やり直し",
        (En, "edit.redo") => "Redo",
        (Ja, "edit.cut") => "切り取り",
        (En, "edit.cut") => "Cut",
        (Ja, "edit.copy") => "コピー",
        (En, "edit.copy") => "Copy",
        (Ja, "edit.paste") => "貼り付け",
        (En, "edit.paste") => "Paste",
        (Ja, "edit.select_all") => "すべて選択",
        (En, "edit.select_all") => "Select All",

        // ファイル
        (Ja, "file.new") => "新規タブ",
        (En, "file.new") => "New tab",
        (Ja, "file.open") => "開く...",
        (En, "file.open") => "Open...",
        (Ja, "file.save") => "保存",
        (En, "file.save") => "Save",
        (Ja, "file.save_as") => "名前を付けて保存...",
        (En, "file.save_as") => "Save as...",
        (Ja, "file.close") => "タブを閉じる",
        (En, "file.close") => "Close tab",
        (Ja, "file.export_html") => "HTMLとして出力...",
        (En, "file.export_html") => "Export as HTML...",
        (Ja, "file.html_preview") => "HTMLプレビューを表示",
        (En, "file.html_preview") => "Show HTML preview",
        (Ja, "file.print") => "印刷...",
        (En, "file.print") => "Print...",
        (Ja, "file.history_more") => "ファイルヒストリの続き",
        (En, "file.history_more") => "More recent files",
        (Ja, "file.quit") => "終了",
        (En, "file.quit") => "Quit",

        // 書式
        (Ja, "fmt.bold") => "太字",
        (En, "fmt.bold") => "Bold",
        (Ja, "fmt.italic") => "斜体",
        (En, "fmt.italic") => "Italic",
        (Ja, "fmt.strike") => "取り消し線",
        (En, "fmt.strike") => "Strikethrough",
        (Ja, "fmt.code") => "インラインコード",
        (En, "fmt.code") => "Inline code",
        (Ja, "fmt.h1") => "見出し1",
        (En, "fmt.h1") => "Heading 1",
        (Ja, "fmt.h2") => "見出し2",
        (En, "fmt.h2") => "Heading 2",
        (Ja, "fmt.h3") => "見出し3",
        (En, "fmt.h3") => "Heading 3",
        (Ja, "fmt.quote") => "引用",
        (En, "fmt.quote") => "Quote",
        (Ja, "fmt.bullet") => "箇条書きリスト",
        (En, "fmt.bullet") => "Bulleted list",
        (Ja, "fmt.ordered") => "番号付きリスト",
        (En, "fmt.ordered") => "Numbered list",
        (Ja, "fmt.codeblock") => "コードブロック",
        (En, "fmt.codeblock") => "Code block",
        (Ja, "fmt.table") => "表を挿入",
        (En, "fmt.table") => "Insert table",
        (Ja, "fmt.hr") => "区切り線",
        (En, "fmt.hr") => "Horizontal rule",
        (Ja, "fmt.link") => "リンク",
        (En, "fmt.link") => "Link",

        // 表示
        (Ja, "view.zoom_in") => "文字サイズを大きく",
        (En, "view.zoom_in") => "Zoom in",
        (Ja, "view.zoom_out") => "文字サイズを小さく",
        (En, "view.zoom_out") => "Zoom out",
        (Ja, "view.zoom_reset") => "文字サイズをリセット",
        (En, "view.zoom_reset") => "Reset zoom",
        (Ja, "view.settings") => "設定...",
        (En, "view.settings") => "Settings...",

        // ヘルプ
        (Ja, "help.about") => "mdeditについて",
        (En, "help.about") => "About mdedit",

        _ => key,
    };
    s.to_string()
}
