/**
 * markdown-it に「style が color:#hex 1つだけの <span> / </span> のみ」を
 * 文字色として通すインラインルールを追加する。アプリは raw HTML を意図的に
 * エスケープする（html:false）設計のため、全 HTML を有効化せず、この形だけを
 * ホワイトリストで解釈する。名前色・空白入り・他属性付きは対象外＝従来どおり
 * エスケープされる。
 *
 * 出力は原文をそのまま通さず、捕捉した hex から開きタグを再構築する
 * （ホワイトリスト外の文字列が出力へ漏れない安全策）。
 */
import type MarkdownIt from "markdown-it";

const OPEN_RE = /^<span style="color:(#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6}))">/i;
const CLOSE_RE = /^<\/span>/i;

export function textColorTagPlugin(md: MarkdownIt): void {
  md.inline.ruler.push("color_span_tag", (state, silent) => {
    if (state.src.charCodeAt(state.pos) !== 0x3c /* < */) return false;
    const rest = state.src.slice(state.pos);
    const open = OPEN_RE.exec(rest);
    const close = open ? null : CLOSE_RE.exec(rest);
    const m = open ?? close;
    if (!m) return false;
    if (!silent) {
      const token = state.push("html_inline", "", 0);
      token.content = open
        ? `<span style="color:${open[1].toLowerCase()}">`
        : "</span>";
    }
    state.pos += m[0].length;
    return true;
  });
}
