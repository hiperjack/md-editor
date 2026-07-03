/**
 * 文字色マーク。
 *
 * Markdown に文字色構文はないため、`<span style="color:#xxxxxx">テキスト</span>`
 * タグとして保存する（Obsidian 等で HTML 直書きする際の事実上の標準形）。
 * アプリは raw HTML をエスケープして扱う設計のため、全 HTML を有効化せず
 * 「style が color:#hex 1つだけの <span>/</span> ペア」だけを解釈する:
 *
 *  - パース: remark が生成する html インラインノードのうち、同一親内で
 *    <span style="color:#hex"> と </span> が対になっているものを textColor
 *    ノードへ畳む（remarkTextColor）。閉じタグのない不対応タグは html
 *    ノードのまま温存され、保存時も原文どおり出力される。
 *  - hex 値は原文どおり attr に保持する（#F00 は #F00 のまま往復し、
 *    大小文字・3桁/6桁を正規化しない）。
 *  - スキーマ: エディタ内 DOM は <span style="color:…">（textColorSchema）。
 *  - 保存: toMarkdown で textColor mdast ノードを出力し、editor.ts 側の
 *    remark-stringify ハンドラ（textColorHandler）が span タグに直列化する。
 *
 * 実装は underline.ts（<u> ペア）と同型。属性が乗る分だけ畳み込みと
 * スキーマが拡張されている。あえて共通化はしない（2例のための間接層を
 * 避ける。3例目が必要になったら抽出する）。
 */
import { $command, $markSchema } from "@milkdown/kit/utils";

export type TextColorMdastNode = {
  type: string;
  value?: string;
  color?: string;
  children?: TextColorMdastNode[];
};

/** 開きタグ厳密形。style は color:#hex（3桁/6桁）1つだけ。他属性・空白・; は不許可。 */
const OPEN_RE = /^<span style="color:(#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6}))">$/i;
const CLOSE_RE = /^<\/span>$/i;

/** 同一親内の <span style="color:#hex">/</span> html ノードペアを textColor ノードへ畳む（破壊的）。 */
export function pairTextColorNodes(node: TextColorMdastNode): void {
  if (!Array.isArray(node.children)) return;
  for (const child of node.children) pairTextColorNodes(child);

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
      type: "textColor",
      color: open[1],
      children: inner,
    });
  }
}

/** remark プラグイン本体。mdast ツリーを直接書き換える。 */
export function remarkTextColor() {
  return (tree: TextColorMdastNode): void => {
    pairTextColorNodes(tree);
  };
}

/**
 * CSS の色値を "#rrggbb"（小文字6桁）へ変換する。ペースト時に DOM が
 * rgb(r, g, b) へ正規化した値を hex に戻すために使う。解釈不能なら null。
 */
export function cssColorToHex(value: string): string | null {
  const v = value.trim();
  const hex = /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.exec(v);
  if (hex) return v;
  const rgb = /^rgb\(\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})\s*\)$/.exec(v);
  if (!rgb) return null;
  const to2 = (s: string): string | null => {
    const n = Number(s);
    if (n > 255) return null;
    return n.toString(16).padStart(2, "0");
  };
  const r = to2(rgb[1]);
  const g = to2(rgb[2]);
  const b = to2(rgb[3]);
  return r && g && b ? `#${r}${g}${b}` : null;
}

export const textColorSchema = $markSchema("textColor", () => ({
  attrs: { color: {} },
  parseDOM: [
    {
      tag: "span[style*=color]",
      getAttrs: (dom) => {
        // ペースト由来の rgb() 表記は hex へ変換する。color 以外の style は捨てる。
        const hex = cssColorToHex((dom as HTMLElement).style.color);
        return hex ? { color: hex } : false;
      },
    },
  ],
  toDOM: (mark) => ["span", { style: `color:${mark.attrs.color}` }, 0] as const,
  parseMarkdown: {
    match: (node) => node.type === "textColor",
    runner: (state, node, markType) => {
      state.openMark(markType, {
        color: (node as { color?: string }).color ?? "",
      });
      state.next(node.children);
      state.closeMark(markType);
    },
  },
  toMarkdown: {
    match: (mark) => mark.type.name === "textColor",
    runner: (state, mark) => {
      // mdast の textColor ノードに color を乗せて出力する。span タグへの
      // 直列化は editor.ts が登録する textColorHandler が行う。
      state.withMark(mark, "textColor", undefined, {
        color: mark.attrs.color,
      });
    },
  },
}));

/**
 * 文字色の適用/解除コマンド。
 * - color あり: 選択範囲へ適用。同型マークは ProseMirror の既定（addToSet）で
 *   置換されるため、別色の上書きが自然に実現する。toggleMark は使わない。
 * - color なし(undefined): 解除。
 * - 空選択時は storedMark を操作し、以後の入力に色が乗る/乗らないを切り替える。
 */
export const setTextColorCommand = $command(
  "SetTextColor",
  (ctx) => (color?: string) => (state, dispatch) => {
    const type = textColorSchema.type(ctx);
    const { from, to, empty } = state.selection;
    if (!color) {
      if (empty) dispatch?.(state.tr.removeStoredMark(type));
      else dispatch?.(state.tr.removeMark(from, to, type));
      return true;
    }
    const mark = type.create({ color });
    if (empty) dispatch?.(state.tr.addStoredMark(mark));
    else dispatch?.(state.tr.addMark(from, to, mark));
    return true;
  },
);

/**
 * remark-stringify ハンドラ。textColor mdast ノードを
 * `<span style="color:…">` + 子 + `</span>` に直列化する。
 * editor.ts の remarkStringifyOptionsCtx から登録する。
 */
export function textColorHandler(
  node: unknown,
  _parent: unknown,
  state: unknown,
  info: unknown,
): string {
  const n = node as { color?: string };
  const s = state as {
    containerPhrasing: (node: unknown, info: unknown) => string;
  };
  return (
    `<span style="color:${n.color ?? ""}">` +
    s.containerPhrasing(node, info) +
    "</span>"
  );
}
