import { describe, it, expect } from "vitest";
import MarkdownIt from "markdown-it";
import { mathPlugin } from "./markdown-it-math";

function makeMd(): MarkdownIt {
  const md = new MarkdownIt({ html: false });
  mathPlugin(md);
  return md;
}

describe("mathPlugin", () => {
  it("インライン $x^2$ を MathML でレンダリングする", () => {
    const html = makeMd().render("area is $x^2$ here");
    expect(html).toContain("<math");
    expect(html).toContain("</math>");
  });

  it("ブロック $$…$$ を display モードでレンダリングする", () => {
    const html = makeMd().render("$$\n\\frac{a}{b}\n$$");
    expect(html).toContain('class="math-block"');
    expect(html).toContain("<math");
  });

  it("1行完結の $$x$$ もブロックとして扱う", () => {
    const html = makeMd().render("$$E=mc^2$$");
    expect(html).toContain('class="math-block"');
  });

  it("価格表記（$5 and $10）を数式と誤認しない", () => {
    const html = makeMd().render("I have $5 and $10 in total");
    expect(html).not.toContain("<math");
    expect(html).toContain("$5 and $10");
  });

  it("エスケープ \\$ は数式にしない", () => {
    const html = makeMd().render("cost \\$100 is $x$");
    // \$100 は素のテキスト、$x$ だけ数式になる
    expect(html).toContain("$100");
    expect(html).toContain("<math");
  });

  it("不正な LaTeX でも例外にならない", () => {
    expect(() => makeMd().render("$\\unknowncmd{$")).not.toThrow();
  });

  it("プラグインなしでは $ はそのまま（現状確認）", () => {
    const md = new MarkdownIt({ html: false });
    expect(md.render("$x^2$")).not.toContain("<math");
  });
});
