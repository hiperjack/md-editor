use std::fs;
use std::path::Path;
use tauri::{AppHandle, Manager, State};

use crate::{FrontendReady, PendingPath};

/// バイト列をテキストへデコードする。
/// UTF-8（BOM有無）として妥当ならUTF-8、ダメなら Shift_JIS(CP932) とみなす。
/// 日本語環境で多い SJIS ファイルを開けるようにするためのフォールバック。
fn decode_bytes(bytes: &[u8]) -> String {
    // UTF-8 BOM があれば除去して UTF-8 として扱う。
    if let Some(rest) = bytes.strip_prefix(&[0xEF, 0xBB, 0xBF]) {
        return String::from_utf8_lossy(rest).into_owned();
    }
    // 妥当な UTF-8 ならそのまま。
    if let Ok(s) = std::str::from_utf8(bytes) {
        return s.to_string();
    }
    // フォールバック: Shift_JIS としてデコード（不正バイトは置換文字に）。
    let (cow, _had_errors) = encoding_rs::SHIFT_JIS.decode_without_bom_handling(bytes);
    cow.into_owned()
}

/// テキストファイルを読む。UTF-8優先、ダメなら Shift_JIS として解釈する。
/// 外部オープン（コマンド/起動引数/関連付け）の双方から使う共通入口。
pub fn read_text_file(path: &str) -> Result<String, String> {
    let bytes = fs::read(path).map_err(|e| format!("read_file({}): {}", path, e))?;
    Ok(decode_bytes(&bytes))
}

#[tauri::command]
pub fn read_file(path: String) -> Result<String, String> {
    read_text_file(&path)
}

#[tauri::command]
pub fn write_file(path: String, content: String) -> Result<(), String> {
    if let Some(parent) = Path::new(&path).parent() {
        if !parent.as_os_str().is_empty() {
            fs::create_dir_all(parent).map_err(|e| format!("create dir: {}", e))?;
        }
    }
    fs::write(&path, content).map_err(|e| format!("write_file({}): {}", path, e))
}

/// 文書テーマ設定の保存先（{appDataDir}/settings.json）。
fn settings_path(app: &AppHandle) -> Result<std::path::PathBuf, String> {
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("app_data_dir: {}", e))?;
    Ok(dir.join("settings.json"))
}

#[tauri::command]
pub fn load_settings(app: AppHandle) -> Result<Option<String>, String> {
    let path = settings_path(&app)?;
    if !path.exists() {
        return Ok(None);
    }
    fs::read_to_string(&path)
        .map(Some)
        .map_err(|e| format!("load_settings: {}", e))
}

#[tauri::command]
pub fn save_settings(app: AppHandle, json: String) -> Result<(), String> {
    let path = settings_path(&app)?;
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|e| format!("create dir: {}", e))?;
    }
    fs::write(&path, json).map_err(|e| format!("save_settings: {}", e))
}

/// 依存最小方針のため base64 は自前実装（標準アルファベット・パディングあり）。
fn base64_encode(data: &[u8]) -> String {
    const TABLE: &[u8; 64] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    let mut out = String::with_capacity(data.len().div_ceil(3) * 4);
    for chunk in data.chunks(3) {
        let b0 = chunk[0] as u32;
        let b1 = u32::from(*chunk.get(1).unwrap_or(&0));
        let b2 = u32::from(*chunk.get(2).unwrap_or(&0));
        let n = (b0 << 16) | (b1 << 8) | b2;
        out.push(TABLE[((n >> 18) & 63) as usize] as char);
        out.push(TABLE[((n >> 12) & 63) as usize] as char);
        out.push(if chunk.len() > 1 {
            TABLE[((n >> 6) & 63) as usize] as char
        } else {
            '='
        });
        out.push(if chunk.len() > 2 {
            TABLE[(n & 63) as usize] as char
        } else {
            '='
        });
    }
    out
}

/// HTML出力時のローカル画像埋め込み（data URI化）用。
#[tauri::command]
pub fn read_file_base64(path: String) -> Result<String, String> {
    let bytes = fs::read(&path).map_err(|e| format!("read_file_base64({}): {}", path, e))?;
    Ok(base64_encode(&bytes))
}

/// 自前 base64 デコード（標準アルファベット・パディング必須）。
fn base64_decode(s: &str) -> Result<Vec<u8>, String> {
    fn val(c: u8) -> Option<u8> {
        match c {
            b'A'..=b'Z' => Some(c - b'A'),
            b'a'..=b'z' => Some(c - b'a' + 26),
            b'0'..=b'9' => Some(c - b'0' + 52),
            b'+' => Some(62),
            b'/' => Some(63),
            _ => None,
        }
    }
    // 空白・改行は無視する。
    let bytes: Vec<u8> = s.bytes().filter(|b| !b.is_ascii_whitespace()).collect();
    if bytes.len() % 4 != 0 {
        return Err("base64: invalid length".to_string());
    }
    let n_chunks = bytes.len() / 4;
    let mut out = Vec::with_capacity(n_chunks * 3);
    for (ci, chunk) in bytes.chunks(4).enumerate() {
        let pad = chunk.iter().filter(|&&b| b == b'=').count();
        // '=' は最終チャンクの末尾1〜2文字のみ許可する。
        let is_last = ci + 1 == n_chunks;
        if pad > 0 && !is_last {
            return Err("base64: misplaced padding".to_string());
        }
        if pad > 2 || chunk[0] == b'=' || chunk[1] == b'=' || (pad == 1 && chunk[2] == b'=') {
            return Err("base64: invalid padding".to_string());
        }
        let mut n = 0u32;
        for (i, &c) in chunk.iter().enumerate() {
            let v = if c == b'=' { 0 } else { val(c).ok_or("base64: invalid char")? };
            n |= (v as u32) << (18 - 6 * i);
        }
        out.push((n >> 16) as u8);
        if pad < 2 {
            out.push((n >> 8) as u8);
        }
        if pad < 1 {
            out.push(n as u8);
        }
    }
    Ok(out)
}

/// base64 で受け取ったバイト列をファイルへ書き込む（貼り付け画像の永続化用）。
#[tauri::command]
pub fn write_file_base64(path: String, base64: String) -> Result<(), String> {
    let bytes = base64_decode(&base64)?;
    if let Some(parent) = Path::new(&path).parent() {
        if !parent.as_os_str().is_empty() {
            fs::create_dir_all(parent).map_err(|e| format!("create dir: {}", e))?;
        }
    }
    fs::write(&path, bytes).map_err(|e| format!("write_file_base64({}): {}", path, e))
}

#[tauri::command]
pub fn add_recent_file(app: AppHandle, path: String) -> Result<(), String> {
    crate::recent::add(&app, path);
    Ok(())
}

#[tauri::command]
pub fn set_recent_visible(app: AppHandle, show: bool) -> Result<(), String> {
    crate::recent::set_visible(&app, show);
    Ok(())
}

#[tauri::command]
pub fn set_lang(app: AppHandle, lang: String) -> Result<(), String> {
    crate::i18n::set(&app, crate::i18n::Lang::from_code(&lang));
    Ok(())
}

/// 最近開いたファイルの一覧を返す（HTMLメニューバーのファイルメニュー用）。
#[tauri::command]
pub fn list_recent_files(app: AppHandle) -> Vec<String> {
    crate::recent::current(&app)
}

/// 旧: ネイティブメニュー割り当て。メニューはHTMLで描画するため何もしない。
#[tauri::command]
pub fn init_window_menu() -> Result<(), String> {
    Ok(())
}

#[tauri::command]
pub fn open_external_url(url: String) -> Result<(), String> {
    // 既定ブラウザで開く対象は http/https のみに限定する。
    // file:/javascript:/その他スキームは拒否（任意コマンド実行回避）。
    let lower = url.to_ascii_lowercase();
    if !(lower.starts_with("http://") || lower.starts_with("https://")) {
        return Err(format!("unsupported url scheme: {}", url));
    }
    // URL に制御文字や改行が含まれていたら拒否。
    if url.chars().any(|c| c.is_control()) {
        return Err("url contains control characters".to_string());
    }

    #[cfg(target_os = "windows")]
    {
        // `start` は cmd.exe の組み込みコマンドのため、cmd 経由で起動する。
        // 第1引数の "" はウィンドウタイトル（URL を誤ってタイトルとして消費させない）。
        // CREATE_NO_WINDOW で cmd.exe のコンソールが一瞬チラつくのを抑止。
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        std::process::Command::new("cmd")
            .args(["/C", "start", "", &url])
            .creation_flags(CREATE_NO_WINDOW)
            .spawn()
            .map_err(|e| format!("spawn start: {}", e))?;
    }
    #[cfg(target_os = "macos")]
    {
        std::process::Command::new("open")
            .arg(&url)
            .spawn()
            .map_err(|e| format!("spawn open: {}", e))?;
    }
    #[cfg(all(unix, not(target_os = "macos")))]
    {
        std::process::Command::new("xdg-open")
            .arg(&url)
            .spawn()
            .map_err(|e| format!("spawn xdg-open: {}", e))?;
    }
    Ok(())
}

#[tauri::command]
pub fn frontend_ready(app: AppHandle) -> Result<(), String> {
    {
        let state: State<FrontendReady> = app.state();
        let mut ready = state
            .0
            .lock()
            .map_err(|e| format!("FrontendReady lock: {}", e))?;
        *ready = true;
    }
    let pending = {
        let state: State<PendingPath> = app.state();
        let mut guard = state
            .0
            .lock()
            .map_err(|e| format!("PendingPath lock: {}", e))?;
        guard.take()
    };
    if let Some(path) = pending {
        crate::startup::emit_open_file(&app, path);
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn decode_plain_utf8() {
        assert_eq!(decode_bytes("こんにちは".as_bytes()), "こんにちは");
    }

    #[test]
    fn decode_strips_utf8_bom() {
        let mut bytes = vec![0xEF, 0xBB, 0xBF];
        bytes.extend_from_slice("hi".as_bytes());
        assert_eq!(decode_bytes(&bytes), "hi");
    }

    #[test]
    fn decode_shift_jis_fallback() {
        // Shift_JIS: "あいう" = 82 A0 / 82 A2 / 82 A4
        let sjis = [0x82, 0xA0, 0x82, 0xA2, 0x82, 0xA4];
        assert_eq!(decode_bytes(&sjis), "あいう");
    }

    #[test]
    fn base64_roundtrip() {
        let data: Vec<u8> = (0u8..=255).collect();
        let encoded = base64_encode(&data);
        let decoded = base64_decode(&encoded).expect("decode ok");
        assert_eq!(decoded, data);
    }

    #[test]
    fn base64_decode_rejects_bad_length() {
        assert!(base64_decode("AAA").is_err());
    }

    #[test]
    fn base64_decode_rejects_bad_padding() {
        assert!(base64_decode("====").is_err());
        assert!(base64_decode("A===").is_err());
        assert!(base64_decode("=AAA").is_err());
        assert!(base64_decode("AA=A").is_err());
    }

    #[test]
    fn base64_decode_handles_padding_lengths() {
        for data in [vec![1u8], vec![1u8, 2], vec![1u8, 2, 3]] {
            let enc = base64_encode(&data);
            assert_eq!(base64_decode(&enc).unwrap(), data, "roundtrip for {:?}", data);
        }
    }
}
