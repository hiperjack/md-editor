import { describe, it, expect } from "vitest";
import MarkdownIt from "markdown-it";
import { underlineTagPlugin } from "./markdown-it-underline";

function makeMd(): MarkdownIt {
  // アプリ本体と同じ html:false（raw HTML はエスケープ）を前提にする
  const md = new MarkdownIt({ html: false });
  underlineTagPlugin(md);
  return md;
}

describe("underlineTagPlugin", () => {
  it("<u>...</u> ペアを u 要素として出力する", () => {
    const html = makeMd().render("a <u>b</u> c");
    expect(html).toContain("<u>b</u>");
  });

  it("大文字 <U> も対象にする", () => {
    const html = makeMd().render("a <U>b</U> c");
    expect(html).toContain("<u>b</u>");
  });

  it("属性付きタグは解釈せずエスケープする（安全側）", () => {
    const html = makeMd().render('a <u onclick="x">b</u> c');
    expect(html).not.toContain("<u onclick");
    expect(html).toContain("&lt;u onclick=");
  });

  it("プラグインなしでは <u> がエスケープされる（現状確認）", () => {
    const md = new MarkdownIt({ html: false });
    expect(md.render("a <u>b</u> c")).not.toContain("<u>b</u>");
  });

  it("太字と併用できる", () => {
    const html = makeMd().render("<u>**b**</u>");
    expect(html).toContain("<u><strong>b</strong></u>");
  });
});
