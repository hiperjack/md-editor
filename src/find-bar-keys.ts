/**
 * 検索・置換バーのキー操作を判定する純粋ロジック。
 * DOM に依存しないので vitest で検証できる。
 */
import { mnemonicChar } from "./menu-bar";

export type FindBarKeyAction =
  | "replace"
  | "replaceAll"
  | "focusReplace"
  | "focusFind";

export type FindBarKeyContext = {
  /** 置換行（置換欄・置換ボタン）が表示されているか。 */
  replaceVisible: boolean;
  /** キー入力時にフォーカスがどこにあるか。 */
  focus: "find" | "replace" | "other";
};

type KeyLike = Pick<
  KeyboardEvent,
  "key" | "code" | "altKey" | "ctrlKey" | "metaKey" | "shiftKey"
>;

/** keydown からバーが消費すべき操作を返す。該当しなければ null（既定動作に任せる）。 */
export function findBarKeyAction(
  e: KeyLike,
  ctx: FindBarKeyContext,
): FindBarKeyAction | null {
  if (!ctx.replaceVisible) return null;

  // Alt+R = 置換 / Alt+A = すべて置換（Ctrl/Meta 併用は他機能に譲る）。
  if (e.altKey && !e.ctrlKey && !e.metaKey) {
    const ch = mnemonicChar(e);
    if (ch === "r") return "replace";
    if (ch === "a") return "replaceAll";
    return null;
  }

  // 検索欄 Tab → 置換欄、置換欄 Shift+Tab → 検索欄。
  if (e.key === "Tab" && !e.altKey && !e.ctrlKey && !e.metaKey) {
    if (ctx.focus === "find" && !e.shiftKey) return "focusReplace";
    if (ctx.focus === "replace" && e.shiftKey) return "focusFind";
  }
  return null;
}
