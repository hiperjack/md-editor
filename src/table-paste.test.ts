// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { mergeTableCellBlocks } from "./table-paste";

function parse(html: string): Document {
  return new DOMParser().parseFromString(html, "text/html");
}

function cellHtml(doc: Document): string[][] {
  return Array.from(doc.querySelectorAll("tr")).map((tr) =>
    Array.from(tr.children).map((c) => c.innerHTML),
  );
}

describe("mergeTableCellBlocks（貼り付け表のセル内複数段落）", () => {
  it("PowerPoint 形式のセル内複数 <p> を <br> 区切りの 1 段落へまとめる", () => {
    const doc = parse(
      `<table><tr><td><p class=MsoNormal><span>A</span></p></td></tr>` +
        `<tr><td><p class=MsoNormal><span>Line 1</span></p><p class=MsoNormal><span>Line 2</span></p></td>` +
        `<td><p class=MsoNormal><span>Right</span></p></td></tr></table>`,
    );
    mergeTableCellBlocks(doc);
    expect(cellHtml(doc)).toEqual([
      [`<p class="MsoNormal"><span>A</span></p>`],
      [`<p><span>Line 1</span><br><span>Line 2</span></p>`, `<p class="MsoNormal"><span>Right</span></p>`],
    ]);
  });

  it("<div> 区切りのセル（Word / ブラウザ由来）も同様にまとめる", () => {
    const doc = parse(
      `<table><tr><td><div>x</div><div>y</div><div>z</div></td></tr></table>`,
    );
    mergeTableCellBlocks(doc);
    expect(cellHtml(doc)).toEqual([[`<p>x<br>y<br>z</p>`]]);
  });

  it("ブロックが 1 つだけのセルや Excel 形式（<br> 直書き）のセルは変更しない", () => {
    const src =
      `<table><tr><td>plain<br>text</td><td><p>one</p></td></tr></table>`;
    const doc = parse(src);
    mergeTableCellBlocks(doc);
    expect(cellHtml(doc)).toEqual([[`plain<br>text`, `<p>one</p>`]]);
  });

  it("<th> のセルも対象にし、空段落は空行として残す", () => {
    const doc = parse(
      `<table><tr><th><p>H1</p><p>&nbsp;</p><p>H2</p></th></tr></table>`,
    );
    mergeTableCellBlocks(doc);
    expect(cellHtml(doc)).toEqual([[`<p>H1<br>&nbsp;<br>H2</p>`]]);
  });
});
