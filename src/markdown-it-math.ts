/**
 * markdown-it に数式（remark-math 互換の $…$ / $$…$$）を追加する。
 *
 * エディタ（Crepe の LaTeX 機能 = remark-math + KaTeX）と同じ記法を
 * プレビュー/HTML出力/PDF でも表示するためのプラグイン。パース規則は
 * markdown-it-katex の実績あるロジックを移植した（価格表記 "$5" などを
 * 数式と誤認しない開閉判定・\$ エスケープ対応を含む）。
 *
 * レンダリングは KaTeX の MathML 出力（output:"mathml"）を使う。
 * HTML出力（フォント・CSS同梱が必要）と違い、MathML はブラウザ
 * ネイティブ描画のため追加アセットが不要で、自己完結HTML・印刷PDF・
 * プレゼン出力すべてでそのまま表示できる（Chromium 109+ / WebView2 対応）。
 */
import type MarkdownIt from "markdown-it";
import katex from "katex";

function renderKatex(src: string, displayMode: boolean): string {
  try {
    return katex.renderToString(src, {
      displayMode,
      output: "mathml",
      throwOnError: false,
    });
  } catch {
    // throwOnError:false でも入力によっては例外があり得るため、原文を温存表示。
    const esc = src
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;");
    return `<code class="math-error">${esc}</code>`;
  }
}

/** $ の開き/閉じとして妥当か（markdown-it-katex 由来の判定）。 */
function isValidDelim(
  state: { src: string; posMax: number },
  pos: number,
): { canOpen: boolean; canClose: boolean } {
  const prevChar = pos > 0 ? state.src.charCodeAt(pos - 1) : -1;
  const nextChar = pos + 1 <= state.posMax ? state.src.charCodeAt(pos + 1) : -1;
  let canOpen = true;
  let canClose = true;
  // 閉じ $: 直前が空白、または直後が数字なら不成立（"$5" 等の価格表記対策）。
  if (
    prevChar === 0x20 ||
    prevChar === 0x09 ||
    (nextChar >= 0x30 && nextChar <= 0x39)
  ) {
    canClose = false;
  }
  // 開き $: 直後が空白なら不成立。
  if (nextChar === 0x20 || nextChar === 0x09) {
    canOpen = false;
  }
  return { canOpen, canClose };
}

export function mathPlugin(md: MarkdownIt): void {
  // インライン $…$
  md.inline.ruler.after("escape", "math_inline", (state, silent) => {
    if (state.src[state.pos] !== "$") return false;

    let res = isValidDelim(state, state.pos);
    if (!res.canOpen) {
      if (!silent) state.pending += "$";
      state.pos += 1;
      return true;
    }

    // 閉じ $ を探す（\$ はエスケープとして読み飛ばす）。
    const start = state.pos + 1;
    let match = start;
    while ((match = state.src.indexOf("$", match)) !== -1) {
      let pos = match - 1;
      while (state.src[pos] === "\\") pos -= 1;
      if ((match - pos) % 2 === 1) break;
      match += 1;
    }
    if (match === -1) {
      if (!silent) state.pending += "$";
      state.pos = start;
      return true;
    }
    if (match - start === 0) {
      if (!silent) state.pending += "$$";
      state.pos = start + 1;
      return true;
    }
    res = isValidDelim(state, match);
    if (!res.canClose) {
      if (!silent) state.pending += "$";
      state.pos = start;
      return true;
    }

    if (!silent) {
      const token = state.push("math_inline", "math", 0);
      token.markup = "$";
      token.content = state.src.slice(start, match);
    }
    state.pos = match + 1;
    return true;
  });

  // ブロック $$…$$
  md.block.ruler.after(
    "blockquote",
    "math_block",
    (state, start, end, silent) => {
      let pos = state.bMarks[start] + state.tShift[start];
      let max = state.eMarks[start];
      if (pos + 2 > max) return false;
      if (state.src.slice(pos, pos + 2) !== "$$") return false;
      pos += 2;
      let firstLine = state.src.slice(pos, max);
      if (silent) return true;

      let found = false;
      if (firstLine.trim().slice(-2) === "$$") {
        // 1行完結（$$…$$）
        firstLine = firstLine.trim().slice(0, -2);
        found = true;
      }

      let next = start;
      let lastLine = "";
      while (!found) {
        next++;
        if (next >= end) break;
        pos = state.bMarks[next] + state.tShift[next];
        max = state.eMarks[next];
        if (pos < max && state.tShift[next] < state.blkIndent) break;
        if (state.src.slice(pos, max).trim().slice(-2) === "$$") {
          const lastPos = state.src.slice(0, max).lastIndexOf("$$");
          lastLine = state.src.slice(pos, lastPos);
          found = true;
        }
      }

      state.line = next + 1;
      const token = state.push("math_block", "math", 0);
      token.block = true;
      token.content =
        (firstLine && firstLine.trim() ? firstLine + "\n" : "") +
        state.getLines(start + 1, next, state.tShift[start], true) +
        (lastLine && lastLine.trim() ? lastLine : "");
      token.map = [start, state.line];
      token.markup = "$$";
      return true;
    },
    { alt: ["paragraph", "reference", "blockquote", "list"] },
  );

  md.renderer.rules.math_inline = (tokens, idx) =>
    renderKatex(tokens[idx].content, false);
  md.renderer.rules.math_block = (tokens, idx) =>
    `<div class="math-block">${renderKatex(tokens[idx].content, true)}</div>\n`;
}
