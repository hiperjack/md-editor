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

/** 画像 alt を分解した結果。width が 0 なら幅指定なし（自動）。 */
export type ImageAlt = { text: string; width: number };

/**
 * markdown の画像 alt を「代替テキスト」と「幅 (px)」に分解する。
 * Obsidian と同じ `![説明|300](img.png)` 形式に対応し、従来の数値だけの
 * `![300](img.png)` も幅として読む。閾値以下の数値は未設定（レガシー倍率）扱い。
 * パイプの後ろが数値でなければ、全体を代替テキストとみなす。
 */
export function parseImageAlt(alt: string | null | undefined): ImageAlt {
  const raw = alt ?? "";
  const toWidth = (s: string): number => {
    const w = Math.round(Number(s));
    return w > IMG_PX_THRESHOLD ? w : 0;
  };
  const m = /^(.*)\|\s*(\d+(?:\.\d+)?)\s*$/.exec(raw);
  if (m) return { text: m[1].trim(), width: toWidth(m[2]) };
  if (raw.trim() !== "" && Number.isFinite(Number(raw))) {
    return { text: "", width: toWidth(raw) };
  }
  return { text: raw, width: 0 };
}

/** 代替テキストと幅から markdown の alt を組み立てる（parseImageAlt の逆）。 */
export function composeImageAlt(text: string, width: number): string {
  const w = Math.round(width);
  const t = text.trim();
  if (w > IMG_PX_THRESHOLD) return t ? `${t}|${w}` : String(w);
  return t;
}

/**
 * 画像の alt 出力を整形する（parseImageAlt → composeImageAlt で正規化）。
 * - 幅だけ → 整数文字列（例 "320"）。閾値以下は "" にクリア（レガシー/未設定）
 * - 代替テキストと幅 → "説明|320"
 * - 代替テキストだけ → そのまま（null/undefined は ""）
 * インライン画像・ブロック画像の双方で同じ規約を使う。
 */
export function formatImageAlt(alt: string | null | undefined): string {
  const { text, width } = parseImageAlt(alt);
  return composeImageAlt(text, width);
}