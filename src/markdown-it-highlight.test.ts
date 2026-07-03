import { describe, it, expect } from "vitest";
import MarkdownIt from "markdown-it";
import { highlightTagPlugin } from "./markdown-it-highlight";

function makeMd(): MarkdownIt {
  const md = new MarkdownIt({ html: false });
  highlightTagPlugin(md);
  return md;
}

describe("highlightTagPlugin", () => {
  it("<mark>...</mark> ペアを mark 要素として出力する", () => {
    const html = makeMd().render("a <mark>b</mark> c");
    expect(html).toContain("<mark>b</mark>");
  });

  it("色付き <mark style=…> は小文字化した hex で出力する", () => {
    const html = makeMd().render('<mark style="background:#FFF59B">b</mark>');
    expect(html).toContain('<mark style="background:#fff59b">b</mark>');
  });

  it.each([
    ["名前色", '<mark style="background:yellow">b</mark>'],
    ["他属性付き", '<mark class="x">b</mark>'],
    ["複数プロパティ", '<mark style="background:#fff59b;color:#000">b</mark>'],
  ])("対象外の開きタグ（%s）はエスケープする（安全側）", (_label, src) => {
    const html = makeMd().render(`a ${src} c`);
    expect(html).not.toContain("<mark ");
    expect(html).toContain("&lt;mark");
  });

  it("プラグインなしでは <mark> がエスケープされる（現状確認）", () => {
    const md = new MarkdownIt({ html: false });
    expect(md.render("a <mark>b</mark> c")).not.toContain("<mark>b</mark>");
  });

  it("太字と併用できる", () => {
    const html = makeMd().render("<mark>**b**</mark>");
    expect(html).toContain("<mark><strong>b</strong></mark>");
  });
});
