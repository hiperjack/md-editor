import { describe, it, expect } from "vitest";
import MarkdownIt from "markdown-it";
import { textColorTagPlugin } from "./markdown-it-text-color";

function makeMd(): MarkdownIt {
  // アプリ本体と同じ html:false（raw HTML はエスケープ）を前提にする
  const md = new MarkdownIt({ html: false });
  textColorTagPlugin(md);
  return md;
}

describe("textColorTagPlugin", () => {
  it('<span style="color:#hex">...</span> ペアを span 要素として出力する', () => {
    const html = makeMd().render('a <span style="color:#ff0000">b</span> c');
    expect(html).toContain('<span style="color:#ff0000">b</span>');
  });

  it("3桁・大文字 hex は小文字化した開きタグで出力する", () => {
    const html = makeMd().render('<span style="color:#F00">b</span>');
    expect(html).toContain('<span style="color:#f00">b</span>');
  });

  it.each([
    ["名前色", '<span style="color:red">b</span>'],
    ["空白入り", '<span style="color: #ff0000">b</span>'],
    ["他属性付き", '<span class="x" style="color:#f00">b</span>'],
    ["複数プロパティ", '<span style="color:#f00;font-weight:bold">b</span>'],
  ])("対象外の開きタグ（%s）はエスケープする（安全側）", (_label, src) => {
    const html = makeMd().render(`a ${src} c`);
    expect(html).not.toContain("<span style");
    expect(html).toContain("&lt;span");
  });

  it("プラグインなしでは span がエスケープされる（現状確認）", () => {
    const md = new MarkdownIt({ html: false });
    const html = md.render('a <span style="color:#ff0000">b</span> c');
    expect(html).not.toContain("<span style");
  });

  it("太字と併用できる", () => {
    const html = makeMd().render('<span style="color:#f00">**b**</span>');
    expect(html).toContain(
      '<span style="color:#f00"><strong>b</strong></span>',
    );
  });

  it("孤立した </span> は raw 出力される（underline と同一挙動）", () => {
    const html = makeMd().render("a </span> c");
    expect(html).toContain("</span>");
  });
});
