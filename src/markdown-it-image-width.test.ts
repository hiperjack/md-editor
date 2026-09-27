import { describe, it, expect } from "vitest";
import MarkdownIt from "markdown-it";
import { imageAltWidthPlugin } from "./markdown-it-image-width";

function render(src: string): string {
  const md = new MarkdownIt({ html: false });
  imageAltWidthPlugin(md);
  return md.renderInline(src);
}

describe("imageAltWidthPlugin", () => {
  it("「説明|幅」を alt と width に分ける", () => {
    expect(render('![説明|300](a.png "cap")')).toBe(
      '<img src="a.png" alt="説明" title="cap" width="300">',
    );
  });
  it("数値だけの alt は幅として扱い、alt は空にする", () => {
    expect(render("![300](a.png)")).toBe('<img src="a.png" alt="" width="300">');
  });
  it("幅指定が無ければ従来どおり", () => {
    expect(render("![説明](a.png)")).toBe('<img src="a.png" alt="説明">');
  });
});
