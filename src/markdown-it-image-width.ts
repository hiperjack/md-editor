import type MarkdownIt from "markdown-it";
import { parseImageAlt } from "./image-row";

/**
 * 画像の alt に書かれた幅を反映する（エディタと同じ規約）。
 * `![説明|300](img.png)` → alt="説明" width="300"、`![300](img.png)` → alt="" width="300"。
 * markdown-it 既定の image 描画と同じく alt は子トークンのテキストから組み立てる。
 */
export function imageAltWidthPlugin(md: MarkdownIt): void {
  md.renderer.rules.image = (tokens, idx, options, env, self) => {
    const token = tokens[idx];
    const raw = self.renderInlineAsText(token.children ?? [], options, env);
    const { text, width } = parseImageAlt(raw);
    token.attrSet("alt", text);
    if (width > 0) token.attrSet("width", String(width));
    return self.renderToken(tokens, idx, options);
  };
}
