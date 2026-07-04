/**
 * markdown-it に「属性なしの <mark>、または style が background:#hex 1つだけの
 * <mark>」をハイライトとして通すインラインルールを追加する。html:false 環境の
 * ホワイトリスト方式（underline / text-color と同じ）。それ以外の形はエスケープ。
 * 出力は捕捉値から再構築する（ホワイトリスト外の文字列が出力へ漏れない安全策）。
 */
import type MarkdownIt from "markdown-it";

const OPEN_RE =
  /^<mark(?: style="background:(#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6}))")?>/i;
const CLOSE_RE = /^<\/mark>/i;

export function highlightTagPlugin(md: MarkdownIt): void {
  md.inline.ruler.push("mark_tag", (state, silent) => {
    if (state.src.charCodeAt(state.pos) !== 0x3c /* < */) return false;
    const rest = state.src.slice(state.pos);
    const open = OPEN_RE.exec(rest);
    const close = open ? null : CLOSE_RE.exec(rest);
    const m = open ?? close;
    if (!m) return false;
    if (!silent) {
      const token = state.push("html_inline", "", 0);
      token.content = open
        ? open[1]
          ? `<mark style="background:${open[1].toLowerCase()}">`
          : "<mark>"
        : "</mark>";
    }
    state.pos += m[0].length;
    return true;
  });
}
