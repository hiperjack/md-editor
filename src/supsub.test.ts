import { describe, it, expect } from "vitest";
import MarkdownIt from "markdown-it";
import {
  pairSupSubNodes,
  superscriptHandler,
  subscriptHandler,
  type SupSubMdastNode,
} from "./supsub";
import { supSubTagPlugin } from "./markdown-it-supsub";

const html = (value: string): SupSubMdastNode => ({ type: "html", value });
const text = (value: string): SupSubMdastNode => ({ type: "text", value });
const para = (...children: SupSubMdastNode[]): SupSubMdastNode => ({
  type: "paragraph",
  children,
});
const root = (...children: SupSubMdastNode[]): SupSubMdastNode => ({
  type: "root",
  children,
});

describe("pairSupSubNodes", () => {
  it("<sup>2</sup> を superscript ノードへ変換する", () => {
    const p = para(text("x"), html("<sup>"), text("2"), html("</sup>"));
    pairSupSubNodes(root(p));
    expect(p.children).toEqual([
      text("x"),
      { type: "superscript", children: [text("2")] },
    ]);
  });

  it("<sub>2</sub> を subscript ノードへ変換する", () => {
    const p = para(text("H"), html("<sub>"), text("2"), html("</sub>"), text("O"));
    pairSupSubNodes(root(p));
    expect(p.children).toEqual([
      text("H"),
      { type: "subscript", children: [text("2")] },
      text("O"),
    ]);
  });

  it("閉じタグ無し・属性付きは温存する", () => {
    const p = para(html("<sup>"), text("a"), html('<sub class="x">'), text("b"), html("</sub>"));
    pairSupSubNodes(root(p));
    expect(p.children).toEqual([
      html("<sup>"),
      text("a"),
      html('<sub class="x">'),
      text("b"),
      html("</sub>"),
    ]);
  });

  it("sup と sub の混在を個別に変換する", () => {
    const p = para(
      html("<sup>"), text("a"), html("</sup>"),
      text(" "),
      html("<sub>"), text("b"), html("</sub>"),
    );
    pairSupSubNodes(root(p));
    expect(p.children).toEqual([
      { type: "superscript", children: [text("a")] },
      text(" "),
      { type: "subscript", children: [text("b")] },
    ]);
  });
});

describe("handlers", () => {
  const state = { containerPhrasing: () => "2" };
  it("superscript → <sup>", () => {
    expect(superscriptHandler({}, null, state, {})).toBe("<sup>2</sup>");
  });
  it("subscript → <sub>", () => {
    expect(subscriptHandler({}, null, state, {})).toBe("<sub>2</sub>");
  });
});

describe("supSubTagPlugin", () => {
  function makeMd(): MarkdownIt {
    const md = new MarkdownIt({ html: false });
    supSubTagPlugin(md);
    return md;
  }

  it("<sup>/<sub> ペアを出力する", () => {
    const html = makeMd().render("x<sup>2</sup> H<sub>2</sub>O");
    expect(html).toContain("<sup>2</sup>");
    expect(html).toContain("<sub>2</sub>");
  });

  it("大文字タグも小文字で出力する", () => {
    expect(makeMd().render("x<SUP>2</SUP>")).toContain("<sup>2</sup>");
  });

  it("属性付きはエスケープする（安全側）", () => {
    const html = makeMd().render('<sup onclick="x">2</sup>');
    expect(html).not.toContain("<sup onclick");
    expect(html).toContain("&lt;sup onclick");
  });
});
