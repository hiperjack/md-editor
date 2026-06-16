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
