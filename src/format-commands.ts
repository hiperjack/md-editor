/**
 * 書式まわりの追加コマンド。
 *  - toggleTaskListCommand: 選択範囲のリスト項目をタスク（チェックボックス）と
 *    通常項目の間でトグルする。リスト外なら呼び出し側で箇条書き化してから使う。
 *  - insertCalloutCommand: `> [!TYPE]` のコールアウト雛形を挿入する。
 *  - clearFormattingCommand: 選択範囲の全インラインマークを解除する。
 */
import {
  listItemSchema,
  blockquoteSchema,
  paragraphSchema,
} from "@milkdown/kit/preset/commonmark";
import { $command } from "@milkdown/kit/utils";

/** GitHub コールアウトの種類（markdown-it-github-alerts が表示対応済み）。 */
export const CALLOUT_TYPES = [
  "NOTE",
  "TIP",
  "IMPORTANT",
  "WARNING",
  "CAUTION",
] as const;
export type CalloutType = (typeof CALLOUT_TYPES)[number];

/**
 * 選択範囲のリスト項目のタスク化/解除をトグルする。
 * 1つでも通常項目（checked=null）があれば全てタスク化、全てタスクなら解除。
 */
export const toggleTaskListCommand = $command(
  "ToggleTaskList",
  (ctx) => () => (state, dispatch) => {
    const liType = listItemSchema.type(ctx);
    const { from, to } = state.selection;
    const items: { pos: number; checked: boolean | null }[] = [];
    state.doc.nodesBetween(from, to, (node, pos) => {
      if (node.type === liType) {
        items.push({
          pos,
          checked: (node.attrs.checked ?? null) as boolean | null,
        });
      }
      return true;
    });
    if (items.length === 0) return false;

    const anyPlain = items.some((it) => it.checked === null);
    const target = anyPlain ? false : null;
    if (dispatch) {
      let tr = state.tr;
      for (const it of items) {
        const node = tr.doc.nodeAt(it.pos);
        if (!node) continue;
        tr = tr.setNodeMarkup(it.pos, undefined, {
          ...node.attrs,
          checked: target,
        });
      }
      dispatch(tr);
    }
    return true;
  },
);

/**
 * カーソル位置にコールアウト雛形（blockquote + [!TYPE] 段落）を挿入する。
 * 続きの本文はユーザーが雛形内で改行して書く。
 */
export const insertCalloutCommand = $command(
  "InsertCallout",
  (ctx) => (kind: CalloutType = "NOTE") => (state, dispatch) => {
    const bqType = blockquoteSchema.type(ctx);
    const pType = paragraphSchema.type(ctx);
    const node = bqType.create(null, [
      pType.create(null, state.schema.text(`[!${kind}]`)),
      pType.create(null),
    ]);
    if (dispatch) {
      dispatch(state.tr.replaceSelectionWith(node).scrollIntoView());
    }
    return true;
  },
);

/**
 * 選択範囲の全インラインマーク（太字・斜体・下線・色・ハイライト等）を解除する。
 * 空選択時は storedMarks を消し、以後の入力を無書式にする。
 */
export const clearFormattingCommand = $command(
  "ClearFormatting",
  (ctx) => () => (state, dispatch) => {
    void ctx;
    const { from, to, empty } = state.selection;
    if (empty) {
      dispatch?.(state.tr.setStoredMarks([]));
      return true;
    }
    // type を省略した removeMark は範囲内の全マークを外す。
    dispatch?.(state.tr.removeMark(from, to));
    return true;
  },
);
