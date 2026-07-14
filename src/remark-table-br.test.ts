import { describe, it, expect } from "vitest";
import { convertTableCellBr, type TableBrMdastNode } from "./remark-table-br";

const cell = (children: TableBrMdastNode[]): TableBrMdastNode => ({
  type: "tableCell",
  children,
});
const html = (value: string): TableBrMdastNode => ({ type: "html", value });
const text = (value: string): TableBrMdastNode => ({ type: "text", value });

describe("convertTableCellBr", () => {
  it("tableCell内の <br> を break ノードへ変換する", () => {
    const tree: TableBrMdastNode = {
      type: "root",
      children: [cell([text("1行目"), html("<br>"), text("2行目")])],
    };
    convertTableCellBr(tree);
    const kids = tree.children![0].children!;
    expect(kids.map((k) => k.type)).toEqual(["text", "break", "text"]);
    expect(kids[1].value).toBeUndefined();
  });

  it("<br/> / <BR> の表記ゆれも変換する", () => {
    const tree: TableBrMdastNode = {
      type: "root",
      children: [cell([html("<br/>"), html("<BR>"), html("<br />")])],
    };
    convertTableCellBr(tree);
    expect(tree.children![0].children!.map((k) => k.type)).toEqual([
      "break",
      "break",
      "break",
    ]);
  });

  it("セルの外の <br> は温存する", () => {
    const tree: TableBrMdastNode = {
      type: "root",
      children: [
        { type: "paragraph", children: [text("段落"), html("<br>")] },
      ],
    };
    convertTableCellBr(tree);
    expect(tree.children![0].children![1]).toEqual({
      type: "html",
      value: "<br>",
    });
  });

  it("セル内の <br> 以外の html ノードは温存する", () => {
    const tree: TableBrMdastNode = {
      type: "root",
      children: [cell([html("<u>"), text("下線"), html("</u>")])],
    };
    convertTableCellBr(tree);
    expect(tree.children![0].children!.map((k) => k.type)).toEqual([
      "html",
      "text",
      "html",
    ]);
  });
});
