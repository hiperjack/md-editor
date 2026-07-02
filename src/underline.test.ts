import { describe, it, expect } from "vitest";
import { pairUnderlineNodes, type UnderlineMdastNode } from "./underline";

const html = (value: string): UnderlineMdastNode => ({ type: "html", value });
const text = (value: string): UnderlineMdastNode => ({ type: "text", value });
const para = (...children: UnderlineMdastNode[]): UnderlineMdastNode => ({
  type: "paragraph",
  children,
});
const root = (...children: UnderlineMdastNode[]): UnderlineMdastNode => ({
  type: "root",
  children,
});

describe("pairUnderlineNodes", () => {
  it("<u>text</u> を underline ノードへ変換する", () => {
    const p = para(text("a "), html("<u>"), text("b"), html("</u>"), text(" c"));
    pairUnderlineNodes(root(p));
    expect(p.children).toEqual([
      text("a "),
      { type: "underline", children: [text("b")] },
      text(" c"),
    ]);
  });

  it("閉じタグのない <u> はそのまま残す（原文保持）", () => {
    const p = para(html("<u>"), text("b"));
    pairUnderlineNodes(root(p));
    expect(p.children).toEqual([html("<u>"), text("b")]);
  });

  it("大文字 </U> もペアとして扱う", () => {
    const p = para(html("<U>"), text("b"), html("</U>"));
    pairUnderlineNodes(root(p));
    expect(p.children).toEqual([{ type: "underline", children: [text("b")] }]);
  });

  it("属性付き <u class=x> は対象外", () => {
    const p = para(html('<u class="x">'), text("b"), html("</u>"));
    pairUnderlineNodes(root(p));
    expect(p.children![0]).toEqual(html('<u class="x">'));
  });

  it("同一段落内の複数ペアを個別に変換する", () => {
    const p = para(
      html("<u>"), text("a"), html("</u>"),
      text(" x "),
      html("<u>"), text("b"), html("</u>"),
    );
    pairUnderlineNodes(root(p));
    expect(p.children).toEqual([
      { type: "underline", children: [text("a")] },
      text(" x "),
      { type: "underline", children: [text("b")] },
    ]);
  });

  it("強調ノードを内包したペアも変換する", () => {
    const strong: UnderlineMdastNode = { type: "strong", children: [text("b")] };
    const p = para(html("<u>"), strong, html("</u>"));
    pairUnderlineNodes(root(p));
    expect(p.children).toEqual([{ type: "underline", children: [strong] }]);
  });
});
