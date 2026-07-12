/**
 * チャットの編集提案（<mdedit-proposal> マーカー）の抽出と後処理。
 * DOM/Tauri に依存しない純関数（chat-panel.ts から使用、単体テスト対象）。
 * マーカーは chat.rs の SYSTEM_PROMPT とペアで変更すること。
 */

/**
 * 提案本文の抽出。貪欲マッチ（[\s\S]*）: 提案する文書自体が行頭の
 * </mdedit-proposal> を含む場合でも、最後の閉じマーカーまでを本文として扱う
 * （提案は1返信1つで末尾に置かれる想定のため、非貪欲だと内側のマーカーで
 * 切れて文書が破損する）。
 */
export const PROPOSAL_RE =
  /^<mdedit-proposal>[ \t]*\r?\n([\s\S]*)\r?\n<\/mdedit-proposal>[ \t]*$/m;

export const PROPOSAL_OPEN_RE = /^<mdedit-proposal>/m;

/**
 * 適用対象の提案本文を抽出する。開きマーカーが複数ある場合
 * （モデルが提案を出し直した場合。1返信に2ブロック入る実例がある）は、
 * 最後のブロック＝モデルの最終版だけを採る。ブロック内は PROPOSAL_RE と
 * 同じ理由で貪欲（本文中の閉じマーカー行では切らず、最後の閉じまで取る）。
 * 閉じマーカーが無い（停止などの中断）場合は null。
 */
export function extractProposal(text: string): string | null {
  const openRe = /^<mdedit-proposal>[ \t]*\r?\n/gm;
  let lastOpen: RegExpExecArray | null = null;
  for (let m; (m = openRe.exec(text)) !== null; ) lastOpen = m;
  if (!lastOpen) return null;
  const body = text.slice(lastOpen.index + lastOpen[0].length);
  const closeRe = /\r?\n<\/mdedit-proposal>[ \t]*$/gm;
  let lastClose: RegExpExecArray | null = null;
  for (let m; (m = closeRe.exec(body)) !== null; ) lastClose = m;
  if (!lastClose) return null;
  return body.slice(0, lastClose.index);
}

/**
 * モデルが文書の枠タグ（<document>/</document>）を提案に写してしまった場合の
 * 除去（system prompt でも禁止しているが、混入した実例があるため保険を張る）。
 */
export function sanitizeProposal(text: string): string {
  return text
    .replace(/^<document[^>\n]*>[ \t]*\r?\n?/, "")
    .replace(/\r?\n?<\/document>[ \t]*$/, "")
    .replace(/^\n+/, "")
    .replace(/\n+$/, "");
}
