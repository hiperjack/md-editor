//! Windows のファイル関連付け（既定アプリ候補）登録。
//! 依存最小方針のため、レジストリ操作は Windows 標準の reg.exe を
//! シェル実行して行う（winreg/windows crate は追加しない）。

#![cfg(target_os = "windows")]

use serde::Serialize;

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

use std::os::windows::process::CommandExt;
use std::process::Command;
use tauri::AppHandle;

const CREATE_NO_WINDOW: u32 = 0x0800_0000;

fn reg() -> Command {
    let mut c = Command::new("reg");
    c.creation_flags(CREATE_NO_WINDOW);
    c
}

/// 現在の実行ファイルパス文字列。
fn exe_path() -> Result<String, String> {
    std::env::current_exe()
        .map_err(|e| format!("current_exe: {}", e))?
        .to_str()
        .map(|s| s.to_string())
        .ok_or_else(|| "exe path is not valid UTF-8".to_string())
}

/// アプリの Capabilities キー。RegisteredApplications からここを指す。
const CAPABILITIES_KEY: &str = "HKCU\\Software\\mdedit\\Capabilities";

/// reg.exe を実行し、成功でなければエラーを返す。
fn run_reg(args: &[&str]) -> Result<(), String> {
    let status = reg()
        .args(args)
        .status()
        .map_err(|e| format!("reg spawn: {}", e))?;
    if status.success() {
        Ok(())
    } else {
        Err(format!("reg failed ({:?}): {:?}", status.code(), args))
    }
}

/// reg.exe を実行するが、キー/値が無い等の失敗は無視する（削除用）。
fn run_reg_lenient(args: &[&str]) {
    let _ = reg().args(args).status();
}

/// RegisteredApplications / Capabilities を登録し、設定アプリの既定アプリ一覧に
/// mdedit を出す。`ms-settings:defaultapps?registeredAppUser=mdedit` の前提。
fn ensure_app_registration() -> Result<(), String> {
    run_reg(&[
        "add", CAPABILITIES_KEY, "/v", "ApplicationName", "/d", "mdedit", "/f",
    ])?;
    run_reg(&[
        "add", CAPABILITIES_KEY, "/v", "ApplicationDescription", "/d",
        "Lightweight Markdown editor", "/f",
    ])?;
    run_reg(&[
        "add", "HKCU\\Software\\RegisteredApplications", "/v", "mdedit", "/d",
        "Software\\mdedit\\Capabilities", "/f",
    ])?;
    Ok(())
}

/// 1拡張子分のProgID＋OpenWithProgids＋Capabilitiesの関連付けをHKCUへ書き込む。
fn register_one(ext: &str, exe: &str) -> Result<(), String> {
    let progid = progid_for_ext(ext);
    let display = display_name_for_ext(ext);
    let classes = format!("HKCU\\Software\\Classes\\{}", progid);
    let cmd_key = format!("{}\\shell\\open\\command", classes);
    // 実際に保存したい値: "<exe>" "%1"
    let command_value = format!("\"{}\" \"%1\"", exe);
    let ext_progids = format!("HKCU\\Software\\Classes\\.{}\\OpenWithProgids", ext);
    let dotted = format!(".{}", ext);
    let fa_key = format!("{}\\FileAssociations", CAPABILITIES_KEY);

    run_reg(&["add", &classes, "/ve", "/d", display, "/f"])?;
    run_reg(&["add", &cmd_key, "/ve", "/d", &command_value, "/f"])?;
    run_reg(&["add", &ext_progids, "/v", &progid, "/t", "REG_NONE", "/f"])?;
    run_reg(&["add", &fa_key, "/v", &dotted, "/d", &progid, "/f"])?;
    Ok(())
}

/// 1拡張子分の登録を取り消す（キー/値が無くてもエラーにしない）。
fn unregister_one(ext: &str) {
    let progid = progid_for_ext(ext);
    let classes = format!("HKCU\\Software\\Classes\\{}", progid);
    let ext_progids = format!("HKCU\\Software\\Classes\\.{}\\OpenWithProgids", ext);
    let dotted = format!(".{}", ext);
    let fa_key = format!("{}\\FileAssociations", CAPABILITIES_KEY);

    run_reg_lenient(&["delete", &ext_progids, "/v", &progid, "/f"]);
    run_reg_lenient(&["delete", &classes, "/f"]);
    run_reg_lenient(&["delete", &fa_key, "/v", &dotted, "/f"]);
}

/// 1拡張子分の状態を判定する。
fn query_one(ext: &str) -> AssocStatus {
    let progid = progid_for_ext(ext);
    let status = {
        // 1) UserChoice の ProgId が自ProgIDと一致 → default
        let user_choice = format!(
            "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\FileExts\\.{}\\UserChoice",
            ext
        );
        let out = reg()
            .args(["query", &user_choice, "/v", "ProgId"])
            .output();
        let is_default = match out {
            Ok(o) if o.status.success() => {
                let text = String::from_utf8_lossy(&o.stdout);
                parse_progid_value(&text).as_deref() == Some(progid.as_str())
            }
            _ => false,
        };
        if is_default {
            "default".to_string()
        } else {
            // 2) OpenWithProgids に自ProgIDが存在 → registered
            let ext_progids = format!("HKCU\\Software\\Classes\\.{}\\OpenWithProgids", ext);
            let exists = reg()
                .args(["query", &ext_progids, "/v", &progid])
                .output()
                .map(|o| o.status.success())
                .unwrap_or(false);
            if exists {
                "registered".to_string()
            } else {
                "none".to_string()
            }
        }
    };
    AssocStatus {
        ext: ext.to_string(),
        status,
    }
}

#[tauri::command]
pub fn query_file_associations(exts: Vec<String>) -> Result<Vec<AssocStatus>, String> {
    Ok(exts.iter().map(|e| query_one(e)).collect())
}

#[tauri::command]
pub fn register_file_associations(exts: Vec<String>) -> Result<(), String> {
    let exe = exe_path()?;
    ensure_app_registration()?;
    for ext in &exts {
        register_one(ext, &exe)?;
    }
    Ok(())
}

#[tauri::command]
pub fn unregister_file_associations(exts: Vec<String>) -> Result<(), String> {
    for ext in &exts {
        unregister_one(ext);
    }
    Ok(())
}

#[tauri::command]
pub fn open_default_apps_settings(_app: AppHandle) -> Result<(), String> {
    // 設定アプリに mdedit を出すための登録を保証してから、mdedit自身の
    // 既定アプリページへジャンプする。
    let _ = ensure_app_registration();
    // cmd /C start "" "<uri>"（"" はウィンドウタイトル）
    Command::new("cmd")
        .args([
            "/C",
            "start",
            "",
            "ms-settings:defaultapps?registeredAppUser=mdedit",
        ])
        .creation_flags(CREATE_NO_WINDOW)
        .spawn()
        .map_err(|e| format!("open ms-settings: {}", e))?;
    Ok(())
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
