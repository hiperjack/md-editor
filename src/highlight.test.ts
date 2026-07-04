import { describe, it, expect } from "vitest";
import {
  pairHighlightNodes,
  highlightHandler,
  type HighlightMdastNode,
} from "./highlight";

const html = (value: string): HighlightMdastNode => ({ type: "html", value });
const text = (value: string): HighlightMdastNode => ({ type: "text", value });
const para = (...children: HighlightMdastNode[]): HighlightMdastNode => ({
  type: "paragraph",
  children,
});
const root = (...children: HighlightMdastNode[]): HighlightMdastNode => ({
  type: "root",
  children,
});

describe("pairHighlightNodes", () => {
  it("<mark>text</mark> を highlight ノード（color:null）へ変換する", () => {
    const p = para(text("a "), html("<mark>"), text("b"), html("</mark>"));
    pairHighlightNodes(root(p));
    expect(p.children).toEqual([
      text("a "),
      { type: "highlight", color: null, children: [text("b")] },
    ]);
  });

  it("色付き <mark style=…> は hex を原文のまま保持する", () => {
    const p = para(
      html('<mark style="background:#FFF59B">'),
      text("b"),
      html("</mark>"),
    );
    pairHighlightNodes(root(p));
    expect(p.children).toEqual([
      { type: "highlight", color: "#FFF59B", children: [text("b")] },
    ]);
  });

  it("閉じタグのない開きタグはそのまま残す（原文保持）", () => {
    const p = para(html("<mark>"), text("b"));
    pairHighlightNodes(root(p));
    expect(p.children).toEqual([html("<mark>"), text("b")]);
  });

  it.each([
    ["名前色", '<mark style="background:yellow">'],
    ["空白入り", '<mark style="background: #fff59b">'],
    ["他プロパティ", '<mark style="background:#fff59b;color:#000">'],
    ["他属性付き", '<mark class="x">'],
  ])("対象外の開きタグ（%s）は温存する", (_label, tag) => {
    const p = para(html(tag), text("b"), html("</mark>"));
    pairHighlightNodes(root(p));
    expect(p.children).toEqual([html(tag), text("b"), html("</mark>")]);
  });

  it("ネストは外側を温存し内側のみペア化する", () => {
    const p = para(
      html("<mark>"),
      text(" a "),
      html('<mark style="background:#fff59b">'),
      text("b"),
      html("</mark>"),
      text(" c "),
      html("</mark>"),
    );
    pairHighlightNodes(root(p));
    expect(p.children).toEqual([
      html("<mark>"),
      text(" a "),
      { type: "highlight", color: "#fff59b", children: [text("b")] },
      text(" c "),
      html("</mark>"),
    ]);
  });

  it("強調ノードを内包したペアも変換する", () => {
    const strong: HighlightMdastNode = { type: "strong", children: [text("b")] };
    const p = para(html("<mark>"), strong, html("</mark>"));
    pairHighlightNodes(root(p));
    expect(p.children).toEqual([
      { type: "highlight", color: null, children: [strong] },
    ]);
  });
});

describe("highlightHandler", () => {
  const state = { containerPhrasing: () => "b" };
  it("標準マーカーは属性なし <mark> へ直列化する", () => {
    expect(
      highlightHandler({ type: "highlight", color: null }, null, state, {}),
    ).toBe("<mark>b</mark>");
  });
  it("色付きは style 付き <mark> へ直列化する", () => {
    expect(
      highlightHandler({ type: "highlight", color: "#fff59b" }, null, state, {}),
    ).toBe('<mark style="background:#fff59b">b</mark>');
  });
});
