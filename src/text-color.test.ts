import { describe, it, expect } from "vitest";
import {
  pairTextColorNodes,
  cssColorToHex,
  textColorHandler,
  type TextColorMdastNode,
} from "./text-color";

const html = (value: string): TextColorMdastNode => ({ type: "html", value });
const text = (value: string): TextColorMdastNode => ({ type: "text", value });
const para = (...children: TextColorMdastNode[]): TextColorMdastNode => ({
  type: "paragraph",
  children,
});
const root = (...children: TextColorMdastNode[]): TextColorMdastNode => ({
  type: "root",
  children,
});
const open = (hex: string): TextColorMdastNode =>
  html(`<span style="color:${hex}">`);
const close = (): TextColorMdastNode => html("</span>");

describe("pairTextColorNodes", () => {
  it('<span style="color:#ff0000">text</span> を textColor ノードへ変換する', () => {
    const p = para(text("a "), open("#ff0000"), text("b"), close(), text(" c"));
    pairTextColorNodes(root(p));
    expect(p.children).toEqual([
      text("a "),
      { type: "textColor", color: "#ff0000", children: [text("b")] },
      text(" c"),
    ]);
  });

  it("3桁 hex #f00 は原文のまま保持する", () => {
    const p = para(open("#f00"), text("b"), close());
    pairTextColorNodes(root(p));
    expect(p.children).toEqual([
      { type: "textColor", color: "#f00", children: [text("b")] },
    ]);
  });

  it("大文字 hex #FF0000 は原文のまま保持する", () => {
    const p = para(open("#FF0000"), text("b"), close());
    pairTextColorNodes(root(p));
    expect(p.children).toEqual([
      { type: "textColor", color: "#FF0000", children: [text("b")] },
    ]);
  });

  it("大文字タグ <SPAN STYLE=…> もペアとして扱う", () => {
    const p = para(
      html('<SPAN STYLE="COLOR:#ff0000">'),
      text("b"),
      html("</SPAN>"),
    );
    pairTextColorNodes(root(p));
    expect(p.children).toEqual([
      { type: "textColor", color: "#ff0000", children: [text("b")] },
    ]);
  });

  it("閉じタグのない開きタグはそのまま残す（原文保持）", () => {
    const p = para(open("#ff0000"), text("b"));
    pairTextColorNodes(root(p));
    expect(p.children).toEqual([open("#ff0000"), text("b")]);
  });

  it.each([
    ['名前色', '<span style="color:red">'],
    ['空白入り', '<span style="color: #ff0000">'],
    ['セミコロン付き', '<span style="color:#ff0000;">'],
    ['複数プロパティ', '<span style="color:#f00;font-weight:bold">'],
    ['他属性付き', '<span class="x" style="color:#f00">'],
  ])("対象外の開きタグ（%s）は温存する", (_label, tag) => {
    const p = para(html(tag), text("b"), close());
    pairTextColorNodes(root(p));
    expect(p.children).toEqual([html(tag), text("b"), close()]);
  });

  it("ネストは外側を温存し内側のみペア化する", () => {
    const p = para(
      open("#f00"),
      text(" a "),
      open("#00f"),
      text("b"),
      close(),
      text(" c "),
      close(),
    );
    pairTextColorNodes(root(p));
    expect(p.children).toEqual([
      open("#f00"),
      text(" a "),
      { type: "textColor", color: "#00f", children: [text("b")] },
      text(" c "),
      close(),
    ]);
  });

  it("同一段落内の複数ペア（別色）を個別に変換する", () => {
    const p = para(
      open("#e03131"), text("a"), close(),
      text(" x "),
      open("#1971c2"), text("b"), close(),
    );
    pairTextColorNodes(root(p));
    expect(p.children).toEqual([
      { type: "textColor", color: "#e03131", children: [text("a")] },
      text(" x "),
      { type: "textColor", color: "#1971c2", children: [text("b")] },
    ]);
  });

  it("強調ノードを内包したペアも変換する", () => {
    const strong: TextColorMdastNode = { type: "strong", children: [text("b")] };
    const p = para(open("#f00"), strong, close());
    pairTextColorNodes(root(p));
    expect(p.children).toEqual([
      { type: "textColor", color: "#f00", children: [strong] },
    ]);
  });
});

describe("textColorHandler", () => {
  it("textColor ノードを span タグへ直列化する", () => {
    const state = { containerPhrasing: () => "b" };
    const node = { type: "textColor", color: "#e03131", children: [] };
    expect(textColorHandler(node, null, state, {})).toBe(
      '<span style="color:#e03131">b</span>',
    );
  });
});

describe("cssColorToHex", () => {
  it("rgb() を小文字6桁 hex へ変換する", () => {
    expect(cssColorToHex("rgb(224, 49, 49)")).toBe("#e03131");
  });
  it("hex はそのまま返す", () => {
    expect(cssColorToHex("#e03131")).toBe("#e03131");
    expect(cssColorToHex("#F00")).toBe("#F00");
  });
  it("解釈不能なら null", () => {
    expect(cssColorToHex("red")).toBeNull();
    expect(cssColorToHex("rgb(999, 0, 0)")).toBeNull();
    expect(cssColorToHex("")).toBeNull();
  });
});
