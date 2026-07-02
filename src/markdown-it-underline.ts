/**
 * markdown-it に「属性なしの <u> / </u> のみ」を下線として通すインラインルールを
 * 追加する。アプリは raw HTML を意図的にエスケープする（html:false）設計のため、
 * 全 HTML を有効化せず、下線タグだけをホワイトリストで解釈する。
 * 属性付き（<u onclick=...> 等）は対象外＝従来どおりエスケープされる。
 */
import type MarkdownIt from "markdown-it";

// "<u>" または "</u>"（大文字小文字不問・属性なし）だけに一致
const U_TAG_RE = /^<(\/?)u>/i;

export function underlineTagPlugin(md: MarkdownIt): void {
  md.inline.ruler.push("u_tag", (state, silent) => {
    if (state.src.charCodeAt(state.pos) !== 0x3c /* < */) return false;
    const m = U_TAG_RE.exec(state.src.slice(state.pos));
    if (!m) return false;
    if (!silent) {
      const token = state.push("html_inline", "", 0);
      token.content = m[0].toLowerCase();
    }
    state.pos += m[0].length;
    return true;
  });
}
