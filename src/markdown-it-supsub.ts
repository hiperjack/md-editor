/**
 * markdown-it に「属性なしの <sup>/<sub> タグのみ」を通すインラインルールを追加する。
 * html:false 環境のホワイトリスト方式（underline と同じ）。属性付きは対象外＝エスケープ。
 */
import type MarkdownIt from "markdown-it";

const TAG_RE = /^<(\/?)(sup|sub)>/i;

export function supSubTagPlugin(md: MarkdownIt): void {
  md.inline.ruler.push("supsub_tag", (state, silent) => {
    if (state.src.charCodeAt(state.pos) !== 0x3c /* < */) return false;
    const m = TAG_RE.exec(state.src.slice(state.pos));
    if (!m) return false;
    if (!silent) {
      const token = state.push("html_inline", "", 0);
      token.content = m[0].toLowerCase();
    }
    state.pos += m[0].length;
    return true;
  });
}
