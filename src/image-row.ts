/** ノーブレークスペース（インデント表現に使う）。 */
export const NBSP = " ";
/** インデント1段あたりの NBSP 個数。 */
export const INDENT_NBSP = 4;
/** これ以下の数値 alt は「レガシー/未設定」とみなし px 幅扱いしない（editor.ts の IMG_PX_THRESHOLD と一致）。 */
export const IMG_PX_THRESHOLD = 10;

/** 文字列先頭の連続 NBSP の個数を数える。 */
export function countLeadingNbsp(text: string): number {
  let n = 0;
  while (n < text.length && text[n] === NBSP) n++;
  return n;
}

/** 先頭 NBSP 個数から「インデント段数」を返す（端数切り捨て）。 */
export function indentLevel(text: string): number {
  return Math.floor(countLeadingNbsp(text) / INDENT_NBSP);
}

/**
 * 画像の alt 出力を整形する。
 * - 有限数で閾値超 → px 幅として整数文字列（例 "320"）
 * - 有限数で閾値以下 → "" にクリア（レガシー/未設定）
 * - それ以外 → 元の alt をそのまま（null/undefined は ""）
 * インライン画像・ブロック画像の双方で同じ規約を使う。
 */
export function formatImageAlt(alt: string | null | undefined): string {
  const raw = alt ?? "";
  if (raw !== "" && Number.isFinite(Number(raw))) {
    const w = Math.round(Number(raw));
    return w > IMG_PX_THRESHOLD ? String(w) : "";
  }
  return raw;
}