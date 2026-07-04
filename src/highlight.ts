/**
 * ハイライト（蛍光マーカー）マーク。
 *
 * `<mark>テキスト</mark>`（標準＝ブラウザ既定の黄色。GitHub互換）と、
 * `<mark style="background:#hex">テキスト</mark>`（色指定。GitHubでは
 * style が除去され標準の黄色マーカーとして表示される）の2形式のみを
 * 解釈する。方式は underline / text-color と同じホワイトリスト式:
 *
 *  - パース: remark の html インラインノードのうち、上記の厳密形と
 *    </mark> のペアを highlight ノードへ畳む（remarkHighlight）。
 *    不対応タグ（他属性・空白入り等）は html ノードのまま原文温存。
 *  - hex 値は原文どおり attr に保持する（正規化しない）。
 *  - 保存: editor.ts の remark-stringify ハンドラ（highlightHandler）が
 *    <mark> または <mark style="background:#hex"> に直列化する。
 */
import { $command, $markSchema } from "@milkdown/kit/utils";
import { cssColorToHex } from "./text-color";

export type HighlightMdastNode = {
  type: string;
  value?: string;
  /** 背景色 hex。標準マーカー（属性なし <mark>）のとき null。 */
  color?: string | null;
  children?: HighlightMdastNode[];
};

/** 開きタグ厳密形。属性なし、または style="background:#hex"（3/6桁）1つだけ。 */
const OPEN_RE =
  /^<mark(?: style="background:(#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6}))")?>$/i;
const CLOSE_RE = /^<\/mark>$/i;

/** 同一親内の <mark…>/</mark> html ノードペアを highlight ノードへ畳む（破壊的）。 */
export function pairHighlightNodes(node: HighlightMdastNode): void {
  if (!Array.isArray(node.children)) return;
  for (const child of node.children) pairHighlightNodes(child);

  const kids = node.children;
  for (let i = 0; i < kids.length; i++) {
    const k = kids[i];
    if (k.type !== "html") continue;
    const open = OPEN_RE.exec(k.value ?? "");
    if (!open) continue;

    // 直近の閉じタグを探す。先に別の開きタグが現れたら不対応として温存する。
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
    kids.splice(i, close - i + 1, {
      type: "highlight",
      color: open[1] ?? null,
      children: inner,
    });
  }
}

/** remark プラグイン本体。mdast ツリーを直接書き換える。 */
export function remarkHighlight() {
  return (tree: HighlightMdastNode): void => {
    pairHighlightNodes(tree);
  };
}

export const highlightSchema = $markSchema("highlight", () => ({
  attrs: { color: { default: null } },
  parseDOM: [
    {
      tag: "mark",
      getAttrs: (dom) => {
        // 標準マーカーは color: null。色付きはペースト由来の rgb() も hex へ。
        const bg = (dom as HTMLElement).style.backgroundColor;
        return { color: bg ? cssColorToHex(bg) : null };
      },
    },
  ],
  toDOM: (mark) =>
    (mark.attrs.color
      ? ["mark", { style: `background:${mark.attrs.color}` }, 0]
      : ["mark", 0]) as ["mark", ...unknown[]],
  parseMarkdown: {
    match: (node) => node.type === "highlight",
    runner: (state, node, markType) => {
      state.openMark(markType, {
        color: (node as { color?: string | null }).color ?? null,
      });
      state.next(node.children);
      state.closeMark(markType);
    },
  },
  toMarkdown: {
    match: (mark) => mark.type.name === "highlight",
    runner: (state, mark) => {
      // mdast の highlight ノードに color を乗せて出力する。mark タグへの
      // 直列化は editor.ts が登録する highlightHandler が行う。
      state.withMark(mark, "highlight", undefined, {
        color: mark.attrs.color,
      });
    },
  },
}));

/**
 * ハイライトの適用/解除コマンド。
 * - payload が hex 文字列: その色で適用（同型マークは置換）。
 * - payload が ""（空文字）: 標準マーカー（属性なし <mark>）を適用。
 * - payload が undefined: 解除。
 * 空選択時は storedMark を操作し、以後の入力に反映する。
 */
export const setHighlightCommand = $command(
  "SetHighlight",
  (ctx) => (color?: string) => (state, dispatch) => {
    const type = highlightSchema.type(ctx);
    const { from, to, empty } = state.selection;
    if (color === undefined) {
      if (empty) dispatch?.(state.tr.removeStoredMark(type));
      else dispatch?.(state.tr.removeMark(from, to, type));
      return true;
    }
    const mark = type.create({ color: color === "" ? null : color });
    if (empty) dispatch?.(state.tr.addStoredMark(mark));
    else dispatch?.(state.tr.addMark(from, to, mark));
    return true;
  },
);

/**
 * remark-stringify ハンドラ。highlight mdast ノードを
 * `<mark>` / `<mark style="background:#hex">` + 子 + `</mark>` に直列化する。
 */
export function highlightHandler(
  node: unknown,
  _parent: unknown,
  state: unknown,
  info: unknown,
): string {
  const n = node as { color?: string | null };
  const s = state as {
    containerPhrasing: (node: unknown, info: unknown) => string;
  };
  const open = n.color ? `<mark style="background:${n.color}">` : "<mark>";
  return open + s.containerPhrasing(node, info) + "</mark>";
}
