/**
 * 下線マーク。
 *
 * Markdown に下線構文はないため、`<u>テキスト</u>` タグとして保存する
 * （GitHub 互換）。アプリは raw HTML をエスケープして扱う設計のため、
 * 全 HTML を有効化せず「属性なしの <u>/</u> ペア」だけを解釈する:
 *
 *  - パース: remark が生成する html インラインノードのうち、同一親内で
 *    <u> と </u> が対になっているものを underline ノードへ畳む
 *    （remarkUnderline）。閉じタグのない不対応タグは html ノードのまま
 *    温存され、保存時も原文どおり出力される。
 *  - スキーマ: エディタ内 DOM は <u> 要素（underlineSchema）。
 *  - 保存: toMarkdown で underline mdast ノードを出力し、editor.ts 側の
 *    remark-stringify ハンドラが `<u>` + 子 + `</u>` に直列化する。
 */
import { commandsCtx } from "@milkdown/kit/core";
import { toggleMark } from "@milkdown/kit/prose/commands";
import { $command, $markSchema, $useKeymap } from "@milkdown/kit/utils";

export type UnderlineMdastNode = {
  type: string;
  value?: string;
  children?: UnderlineMdastNode[];
};

const OPEN_RE = /^<u>$/i;
const CLOSE_RE = /^<\/u>$/i;

/** 同一親内の <u>/</u> html ノードのペアを underline ノードへ畳む（破壊的）。 */
export function pairUnderlineNodes(node: UnderlineMdastNode): void {
  if (!Array.isArray(node.children)) return;
  for (const child of node.children) pairUnderlineNodes(child);

  const kids = node.children;
  for (let i = 0; i < kids.length; i++) {
    const k = kids[i];
    if (k.type !== "html" || !OPEN_RE.test(k.value ?? "")) continue;

    // 直近の閉じタグを探す。先に別の <u> が現れたら不対応として温存する。
    let close = -1;
    for (let j = i + 1; j < kids.length; j++) {
      const c = kids[j];
      if (c.type !== "html") continue;
      if (CLOSE_RE.test(c.value ?? "")) {
        close = j;
        break;
      }
      if (OPEN_RE.test(c.value ?? "")) break;
    }
    if (close < 0) continue;

    const inner = kids.slice(i + 1, close);
    kids.splice(i, close - i + 1, { type: "underline", children: inner });
  }
}

/** remark プラグイン本体。mdast ツリーを直接書き換える。 */
export function remarkUnderline() {
  return (tree: UnderlineMdastNode): void => {
    pairUnderlineNodes(tree);
  };
}

export const underlineSchema = $markSchema("underline", () => ({
  parseDOM: [{ tag: "u" }],
  toDOM: () => ["u"] as const,
  parseMarkdown: {
    match: (node) => node.type === "underline",
    runner: (state, node, markType) => {
      state.openMark(markType);
      state.next(node.children);
      state.closeMark(markType);
    },
  },
  toMarkdown: {
    match: (mark) => mark.type.name === "underline",
    runner: (state, mark) => {
      // mdast の underline ノードを出力する。<u>...</u> への直列化は
      // editor.ts の remark-stringify ハンドラが行う。
      state.withMark(mark, "underline");
    },
  },
}));

export const toggleUnderlineCommand = $command("ToggleUnderline", (ctx) => () =>
  toggleMark(underlineSchema.type(ctx)),
);

export const underlineKeymap = $useKeymap("underlineKeymap", {
  ToggleUnderline: {
    shortcuts: "Mod-u",
    command: (ctx) => {
      const commands = ctx.get(commandsCtx);
      return () => commands.call(toggleUnderlineCommand.key);
    },
  },
});
