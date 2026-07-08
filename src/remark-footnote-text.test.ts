import { describe, it, expect } from "vitest";
import { unified } from "unified";
import remarkParse from "remark-parse";
import remarkGfm from "remark-gfm";
import { remarkFootnoteText } from "./remark-footnote-text";

type N = { type: string; children?: N[]; value?: string };

function parse(md: string): N {
  const proc = unified().use(remarkParse).use(remarkGfm).use(remarkFootnoteText);
  return proc.runSync(proc.parse(md)) as unknown as N;
}

/** テキスト/改行を連結した平文（break は \n）。 */
function flat(node: N): string {
  if (node.type === "text") return node.value ?? "";
  if (node.type === "break") return "\n";
  return (node.children ?? []).map(flat).join("");
}

function childTypes(node: N): string[] {
  return (node.children ?? []).map((c) => c.type);
}

describe("remarkFootnoteText", () => {
  it("参照をテキスト [^1] に展開する", () => {
    const tree = parse("a[^1]b\n\n[^1]: x");
    expect(childTypes(tree)).toEqual(["paragraph", "paragraph"]);
    expect(flat(tree.children![0])).toBe("a[^1]b");
    expect(JSON.stringify(tree)).not.toContain("footnoteReference");
    expect(JSON.stringify(tree)).not.toContain("footnoteDefinition");
  });

  it("ラベルの大文字小文字を保持する（identifier ではなく label）", () => {
    const tree = parse("x[^Note]\n\n[^Note]: y");
    expect(flat(tree.children![0])).toBe("x[^Note]");
    expect(flat(tree.children![1])).toBe("[^Note]: y");
  });

  it("1行定義を [^1]: 本文 の段落に展開する", () => {
    const tree = parse("r[^1]\n\n[^1]: メモ");
    expect(flat(tree.children![1])).toBe("[^1]: メモ");
  });

  it("怠惰継続（インデントなし複数行）は段落内の \\n として保持する", () => {
    const tree = parse("r[^1]\n\n[^1]: l1\nl2");
    expect(childTypes(tree)).toEqual(["paragraph", "paragraph"]);
    expect(flat(tree.children![1])).toBe("[^1]: l1\nl2");
  });

  it("複数段落の定義（インデント継続）は break で結合した1段落にする", () => {
    const tree = parse("r[^1]\n\n[^1]: p1\n\n    p2");
    const para = tree.children![1];
    expect(para.type).toBe("paragraph");
    expect(para.children!.some((c) => c.type === "break")).toBe(true);
    expect(flat(para)).toBe("[^1]: p1\np2");
  });

  it("定義内のインライン構造（強調等）を保持する", () => {
    const tree = parse("r[^1]\n\n[^1]: **b** i");
    const para = tree.children![1];
    expect(childTypes(para)).toEqual(["text", "strong", "text"]);
    expect(flat(para)).toBe("[^1]: b i");
  });

  it("定義内の参照も展開する", () => {
    const tree = parse("a[^1]\n\n[^1]: see[^2]\n\n[^2]: z");
    expect(JSON.stringify(tree)).not.toContain("footnoteReference");
    expect(flat(tree.children![1])).toBe("[^1]: see[^2]");
    expect(flat(tree.children![2])).toBe("[^2]: z");
  });

  it("段落以外の子ブロックは展開段落の後ろへ独立ブロックとして出す", () => {
    const tree = parse("r[^1]\n\n[^1]: p1\n\n    - item");
    expect(childTypes(tree)).toEqual(["paragraph", "paragraph", "list"]);
    expect(flat(tree.children![1])).toBe("[^1]: p1");
  });

  it("脚注のない文書は変化しない", () => {
    const tree = parse("hello **w**");
    expect(childTypes(tree)).toEqual(["paragraph"]);
    expect(flat(tree.children![0])).toBe("hello w");
  });
});
