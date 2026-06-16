import { invoke } from "@tauri-apps/api/core";
import type { EditorView } from "@milkdown/kit/prose/view";
import { isImageNode } from "./image-edit";

/**
 * 貼り付け画像（data:/blob:）を保存時にディスクへ書き出し、
 * markdown 参照をベアファイル名へ書き換えるための層。
 *
 * 保存先は <mdDir>/img/<md名>/（image-resolver.ts の解決規約に一致）。
 */

const EXT_BY_MIME: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/gif": "gif",
  "image/svg+xml": "svg",
  "image/webp": "webp",
  "image/bmp": "bmp",
  "image/x-icon": "ico",
  "image/avif": "avif",
};

/** mime から拡張子を決める。不明なら png。 */
export function extForMime(mime: string): string {
  return EXT_BY_MIME[mime.toLowerCase()] ?? "png";
}

/** image-YYYYMMDD-HHMMSS-<index>.<ext> 形式のファイル名を作る。 */
export function makeImageFilename(date: Date, index: number, ext: string): string {
  const p = (n: number): string => String(n).padStart(2, "0");
  const ts =
    `${date.getFullYear()}${p(date.getMonth() + 1)}${p(date.getDate())}` +
    `-${p(date.getHours())}${p(date.getMinutes())}${p(date.getSeconds())}`;
  return `image-${ts}-${index}.${ext}`;
}

/** data: URI を {mime, base64} に分解する。base64 でなければ null。 */
export function parseDataUri(src: string): { mime: string; base64: string } | null {
  const m = /^data:([^;,]*);base64,(.*)$/s.exec(src);
  if (!m) return null;
  return { mime: m[1] || "application/octet-stream", base64: m[2] };
}

/** Uint8Array を base64 文字列へ（大きい配列でも安全なようチャンク処理）。 */
export function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

function isEmbeddedSrc(src: string): boolean {
  return src.startsWith("data:") || src.startsWith("blob:");
}

/** ディレクトリとファイル名を結合（区切りはディレクトリの実体に合わせる）。 */
function joinDir(dir: string, name: string): string {
  const sep = dir.includes("\\") ? "\\" : "/";
  return dir.endsWith(sep) ? dir + name : dir + sep + name;
}

/** src（data:/blob:）から base64 とおおよその mime を得る。 */
async function srcToBase64(src: string): Promise<{ base64: string; mime: string }> {
  if (src.startsWith("data:")) {
    const p = parseDataUri(src);
    if (!p) throw new Error("invalid data uri");
    return { base64: p.base64, mime: p.mime };
  }
  // blob: は描画中のメモリ上に生存しているので fetch で取り出せる。
  const resp = await fetch(src);
  const buf = new Uint8Array(await resp.arrayBuffer());
  const mime = resp.headers.get("content-type") || "image/png";
  return { base64: bytesToBase64(buf), mime };
}

export type PersistResult = { written: number; failed: number };

/**
 * doc 内の data:/blob: 画像を imgDir に書き出し、ノード src をベアファイル名へ書換える。
 * 失敗した画像はインラインのまま残す（データを失わない）。
 * @param imgDir 保存先ディレクトリ（絶対パス）。imageDirForMdPath の戻り値。
 * @param now ファイル名生成に使う時刻。
 */
export async function persistEmbeddedImages(
  view: EditorView,
  imgDir: string,
  now: Date,
): Promise<PersistResult> {
  const targets: { pos: number; src: string }[] = [];
  view.state.doc.descendants((node, pos) => {
    if (isImageNode(node)) {
      const src = (node.attrs.src ?? "") as string;
      if (isEmbeddedSrc(src)) targets.push({ pos, src });
      return false; // 画像ノード内に画像ノードは存在しない
    }
    return true;
  });
  if (targets.length === 0) return { written: 0, failed: 0 };

  const rewrites: { pos: number; filename: string }[] = [];
  let failed = 0;
  let idx = 1;
  for (const target of targets) {
    try {
      const { base64, mime } = await srcToBase64(target.src);
      const filename = makeImageFilename(now, idx, extForMime(mime));
      await invoke<void>("write_file_base64", {
        path: joinDir(imgDir, filename),
        base64,
      });
      rewrites.push({ pos: target.pos, filename });
      idx++;
    } catch (e) {
      console.warn("persistEmbeddedImages: write failed:", e);
      failed++;
    }
  }

  // setNodeMarkup はノードサイズを変えないので pos は安定。1 transaction で書換。
  if (rewrites.length > 0) {
    let tr = view.state.tr;
    for (const r of rewrites) {
      const node = tr.doc.nodeAt(r.pos);
      if (!node || !isImageNode(node)) continue;
      tr = tr.setNodeMarkup(r.pos, undefined, { ...node.attrs, src: r.filename });
    }
    view.dispatch(tr);
  }
  return { written: rewrites.length, failed };
}
