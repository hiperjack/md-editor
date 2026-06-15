//! Windows のファイル関連付け（既定アプリ候補）登録。
//! 依存最小方針のため、レジストリ操作は Windows 標準の reg.exe を
//! シェル実行して行う（winreg/windows crate は追加しない）。

#![cfg(target_os = "windows")]

use serde::Serialize;

/// 設定画面で扱う拡張子（先頭ドット無し）。
pub const SUPPORTED_EXTS: &[&str] = &["md", "markdown", "mmd", "mermaid", "txt"];

#[derive(Serialize, Clone, Debug, PartialEq)]
pub struct AssocStatus {
    pub ext: String,
    /// "default" | "registered" | "none"
    pub status: String,
}

/// 拡張子に対応する ProgID（例: "md" -> "mdedit.md"）。
pub fn progid_for_ext(ext: &str) -> String {
    format!("mdedit.{}", ext)
}

/// ProgID の表示名（例: "md"/"markdown" -> "Markdown File"）。
pub fn display_name_for_ext(ext: &str) -> &'static str {
    match ext {
        "md" | "markdown" => "Markdown File",
        "mmd" | "mermaid" => "Mermaid Diagram",
        "txt" => "Text File",
        _ => "mdedit Document",
    }
}

/// `reg query ... /v ProgId` の標準出力から ProgId の値を取り出す。
/// 見つからなければ None。
pub fn parse_progid_value(reg_output: &str) -> Option<String> {
    // 例: "    ProgId    REG_SZ    mdedit.md"
    for line in reg_output.lines() {
        let trimmed = line.trim();
        if trimmed.starts_with("ProgId") {
            if let Some(idx) = trimmed.find("REG_SZ") {
                let value = trimmed[idx + "REG_SZ".len()..].trim();
                if !value.is_empty() {
                    return Some(value.to_string());
                }
            }
        }
    }
    None
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn progid_naming() {
        assert_eq!(progid_for_ext("md"), "mdedit.md");
        assert_eq!(progid_for_ext("markdown"), "mdedit.markdown");
        assert_eq!(progid_for_ext("txt"), "mdedit.txt");
    }

    #[test]
    fn display_names() {
        assert_eq!(display_name_for_ext("md"), "Markdown File");
        assert_eq!(display_name_for_ext("markdown"), "Markdown File");
        assert_eq!(display_name_for_ext("mmd"), "Mermaid Diagram");
        assert_eq!(display_name_for_ext("mermaid"), "Mermaid Diagram");
        assert_eq!(display_name_for_ext("txt"), "Text File");
    }

    #[test]
    fn parse_progid_from_reg_output() {
        let out = "\r\nHKEY_CURRENT_USER\\...\\UserChoice\r\n    ProgId    REG_SZ    mdedit.md\r\n\r\n";
        assert_eq!(parse_progid_value(out), Some("mdedit.md".to_string()));
    }

    #[test]
    fn parse_progid_absent() {
        assert_eq!(parse_progid_value("ERROR: ...\r\n"), None);
    }
}
