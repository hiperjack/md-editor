/**
 * 上付き（<sup>）・下付き（<sub>）マーク。
 *
 * Markdown に標準構文はないため、属性なしの HTML タグとして保存する
 * （GitHub・Obsidian 互換）。方式は underline と同じホワイトリスト式で、
 * 「属性なしの <sup>/</sup>・<sub>/</sub> ペア」だけを解釈する。
 * 不対応タグは html ノードのまま原文温存。
 *
 * 上付きと下付きは同時に成立しないため、マークは相互排他（excludes）にする。
 */
import { toggleMark } from "@milkdown/kit/prose/commands";
import { $command, $markSchema } from "@milkdown/kit/utils";

export type SupSubMdastNode = {
  type: string;
  value?: string;
  children?: SupSubMdastNode[];
};

/** 属性なしタグのペアを nodeType へ畳む（underline.ts と同型の汎用版）。 */
function pairTagNodes(
  node: SupSubMdastNode,
  openRe: RegExp,
  closeRe: RegExp,
  nodeType: string,
): void {
  if (!Array.isArray(node.children)) return;
  for (const child of node.children) pairTagNodes(child, openRe, closeRe, nodeType);

  const kids = node.children;
  for (let i = 0; i < kids.length; i++) {
    const k = kids[i];
    if (k.type !== "html" || !openRe.test(k.value ?? "")) continue;

    let close = -1;
    for (let j = i + 1; j < kids.length; j++) {
      const c = kids[j];
      if (c.type !== "html") continue;
      if (closeRe.test(c.value ?? "")) {
        close = j;
        break;
      }
      if (openRe.test(c.value ?? "")) break;
    }
    if (close < 0) continue;

    const inner = kids.slice(i + 1, close);
    kids.splice(i, close - i + 1, { type: nodeType, children: inner });
  }
}

const SUP_OPEN = /^<sup>$/i;
const SUP_CLOSE = /^<\/sup>$/i;
const SUB_OPEN = /^<sub>$/i;
const SUB_CLOSE = /^<\/sub>$/i;

/** <sup>/<sub> のペアをそれぞれ superscript / subscript ノードへ畳む（破壊的）。 */
export function pairSupSubNodes(node: SupSubMdastNode): void {
  pairTagNodes(node, SUP_OPEN, SUP_CLOSE, "superscript");
  pairTagNodes(node, SUB_OPEN, SUB_CLOSE, "subscript");
}

/** remark プラグイン本体。mdast ツリーを直接書き換える。 */
export function remarkSupSub() {
  return (tree: SupSubMdastNode): void => {
    pairSupSubNodes(tree);
  };
}

export const superscriptSchema = $markSchema("superscript", () => ({
  // 上付きと下付きは同時に付けない（後勝ちで置き換わる）。
  excludes: "superscript subscript",
  parseDOM: [{ tag: "sup" }],
  toDOM: () => ["sup"] as const,
  parseMarkdown: {
    match: (node) => node.type === "superscript",
    runner: (state, node, markType) => {
      state.openMark(markType);
      state.next(node.children);
      state.closeMark(markType);
    },
  },
  toMarkdown: {
    match: (mark) => mark.type.name === "superscript",
    runner: (state, mark) => {
      state.withMark(mark, "superscript");
    },
  },
}));

export const subscriptSchema = $markSchema("subscript", () => ({
  excludes: "superscript subscript",
  parseDOM: [{ tag: "sub" }],
  toDOM: () => ["sub"] as const,
  parseMarkdown: {
    match: (node) => node.type === "subscript",
    runner: (state, node, markType) => {
      state.openMark(markType);
      state.next(node.children);
      state.closeMark(markType);
    },
  },
  toMarkdown: {
    match: (mark) => mark.type.name === "subscript",
    runner: (state, mark) => {
      state.withMark(mark, "subscript");
    },
  },
}));

export const toggleSuperscriptCommand = $command(
  "ToggleSuperscript",
  (ctx) => () => toggleMark(superscriptSchema.type(ctx)),
);

export const toggleSubscriptCommand = $command(
  "ToggleSubscript",
  (ctx) => () => toggleMark(subscriptSchema.type(ctx)),
);

/** remark-stringify ハンドラ（editor.ts から登録）。 */
export function superscriptHandler(
  node: unknown,
  _parent: unknown,
  state: unknown,
  info: unknown,
): string {
  const s = state as {
    containerPhrasing: (node: unknown, info: unknown) => string;
  };
  return "<sup>" + s.containerPhrasing(node, info) + "</sup>";
}

export function subscriptHandler(
  node: unknown,
  _parent: unknown,
  state: unknown,
  info: unknown,
): string {
  const s = state as {
    containerPhrasing: (node: unknown, info: unknown) => string;
  };
  return "<sub>" + s.containerPhrasing(node, info) + "</sub>";
}
