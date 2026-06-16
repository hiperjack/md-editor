import { invoke } from "@tauri-apps/api/core";
import { resolveImagePathCandidates } from "./image-resolver";

/**
 * レンダリング済み文書内のローカル画像を data URI に変換して埋め込む。
 *
 * - HTML出力: 出力ファイルを単体配布しても画像が表示される（自己完結）
 * - PDF印刷: WebView上の #print-root では相対パスが解決できないため必須
 *
 * http(s)/data: のsrcはそのまま。読み込みに失敗した候補は次の候補へ
 * フォールバックし、全滅したら元のsrcを残す。
 */

const MIME_BY_EXT: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  svg: "image/svg+xml",
  webp: "image/webp",
  bmp: "image/bmp",
  ico: "image/x-icon",
  avif: "image/avif",
};

function mimeOf(path: string): string {
  const dot = path.lastIndexOf(".");
  const ext = dot >= 0 ? path.slice(dot + 1).toLowerCase() : "";
  return MIME_BY_EXT[ext] ?? "application/octet-stream";
}

export async function embedLocalImages(
  container: HTMLElement,
  mdFilePath: string | null,
): Promise<void> {
  const imgs = Array.from(container.querySelectorAll("img"));
  for (const img of imgs) {
    const src = img.getAttribute("src") ?? "";
    if (!src || /^(data:|https?:\/\/)/i.test(src)) continue;
    // markdown-it は src をURLエンコードして出力する（空白→%20等）ため戻す
    let raw = src;
    try {
      raw = decodeURIComponent(src);
    } catch {
      // 不正なエンコードはそのまま扱う
    }
    for (const path of resolveImagePathCandidates(raw, mdFilePath)) {
      try {
        const b64 = await invoke<string>("read_file_base64", { path });
        img.setAttribute("src", `data:${mimeOf(path)};base64,${b64}`);
        break;
      } catch {
        // 次の候補へ
      }
    }
  }
}
