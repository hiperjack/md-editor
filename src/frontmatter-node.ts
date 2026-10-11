/**
 * frontmatter（ファイル先頭の `---` YAML ブロック）の Milkdown 連携。
 *
 *  - remark-frontmatter を remark パイプラインに足し、先頭の `---` ブロックを
 *    mdast の `yaml` ノードとして読む（これが無いと `---` は区切り線、中身は段落や
 *    setext 見出しとして解釈され、保存で `***` などに書き換わってしまう）。
 *  - `yaml` ノードを frontmatter ノード（atom、value 属性に生の YAML）へ写し、
 *    保存時は `yaml` ノードへ戻す。mdast-util-frontmatter が `---` で挟んで出力する
 *    ので、編集しなければ元の frontmatter がそのまま書き戻る。
 *  - NodeView（frontmatter-view.ts）が Obsidian のプロパティ風の表として描画・編集する。
 */
import remarkFrontmatter from "remark-frontmatter";
import { $nodeSchema, $remark, $view } from "@milkdown/kit/utils";
import { FrontmatterNodeView } from "./frontmatter-view";

export const FRONTMATTER_NODE = "frontmatter";

// Milkdown は $remark の initialOptions（未指定なら {}）を unified の use() に渡す。
// remark-frontmatter は {} を「type の無い matter 定義」と解釈して例外を投げるため、
// プリセット名 "yaml" を明示する。
export const frontmatterRemark = $remark(
  "remark-frontmatter",
  () => remarkFrontmatter as unknown as (options: string) => void,
  "yaml",
);

export const frontmatterSchema = $nodeSchema(FRONTMATTER_NODE, () => ({
  group: "block",
  atom: true,
  selectable: true,
  draggable: false,
  isolating: true,
  attrs: { value: { default: "" } },
  parseDOM: [
    {
      tag: 'div[data-type="frontmatter"]',
      getAttrs: (dom) => ({
        value: (dom as HTMLElement).getAttribute("data-value") ?? "",
      }),
    },
  ],
  toDOM: (node) => [
    "div",
    { "data-type": "frontmatter", "data-value": node.attrs.value as string },
  ],
  parseMarkdown: {
    match: (node) => node.type === "yaml",
    runner: (state, node, type) => {
      state.addNode(type, { value: (node.value as string) ?? "" });
    },
  },
  toMarkdown: {
    match: (node) => node.type.name === FRONTMATTER_NODE,
    runner: (state, node) => {
      state.addNode("yaml", undefined, node.attrs.value as string);
    },
  },
}));

export const frontmatterView = $view(
  frontmatterSchema.node,
  () => (node, view, getPos) => new FrontmatterNodeView(node, view, getPos),
);

/** Crepe の機能登録後・create 前に `editor.use` する一式。 */
export const frontmatterPlugins = [
  frontmatterRemark,
  frontmatterSchema,
  frontmatterView,
].flat();
