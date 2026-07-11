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
