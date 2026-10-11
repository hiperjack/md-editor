import { describe, it, expect } from "vitest";
import { unified } from "unified";
import remarkParse from "remark-parse";
import remarkStringify from "remark-stringify";
import remarkGfm from "remark-gfm";
import remarkFrontmatter from "remark-frontmatter";

/**
 * エディタの remark パイプラインに remark-frontmatter を足したときの挙動。
 * Milkdown 本体は使わず、同じ remark 構成で「yaml ノードとして読める」
 * 「--- で挟んで書き戻せる」ことを確かめる（frontmatter-node.ts の前提）。
 */
const SRC = [
  "---",
  "type: project",
  'name: "AIナレッジ化"',
  "tags:",
  "  - a",
  "  - b",
  "---",
  "",
  "# 見出し",
  "",
  "本文",
  "",
].join("\n");

function processor() {
  return unified().use(remarkParse).use(remarkGfm).use(remarkFrontmatter);
}

describe("remark-frontmatter を含む remark パイプライン", () => {
  it("先頭の --- ブロックを yaml ノードとして読み、本文は壊れない", () => {
    const tree = processor().parse(SRC) as {
      children: { type: string; value?: string; depth?: number }[];
    };
    expect(tree.children[0].type).toBe("yaml");
    expect(tree.children[0].value).toBe(
      'type: project\nname: "AIナレッジ化"\ntags:\n  - a\n  - b',
    );
    // 以前は thematicBreak + paragraph + list + thematicBreak に化けていた
    expect(tree.children.map((c) => c.type)).toEqual(["yaml", "heading", "paragraph"]);
    expect(tree.children[1].depth).toBe(1);
  });

  it("往復で frontmatter がそのまま書き戻る", () => {
    const out = String(
      processor().use(remarkStringify, { rule: "-" }).processSync(SRC),
    );
    expect(out.startsWith('---\ntype: project\nname: "AIナレッジ化"\ntags:\n  - a\n  - b\n---\n')).toBe(true);
    expect(out).toContain("# 見出し");
  });

  it("先頭でない --- は従来どおり区切り線のまま", () => {
    const tree = processor().parse("# a\n\n---\n\nb\n") as {
      children: { type: string }[];
    };
    expect(tree.children.map((c) => c.type)).toEqual([
      "heading",
      "thematicBreak",
      "paragraph",
    ]);
  });
});
