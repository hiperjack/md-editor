import type { HighlightTheme } from "./theme";
import documentCss from "./styles/document.css?raw";
import hljsGithubCss from "highlight.js/styles/github.css?raw";
import hljsAtomOneDarkCss from "highlight.js/styles/atom-one-dark.css?raw";
import hljsVsCss from "highlight.js/styles/vs.css?raw";

/**
 * 文書テーマCSSの供給元。
 * - HTML出力: 文字列としてインライン展開（exporter.ts）
 * - 印刷 / 設定モーダル内サンプル: アプリDOMへ<style>として注入
 */

export const DOCUMENT_CSS: string = documentCss;

export const HLJS_THEME_CSS: Record<HighlightTheme, string> = {
  github: hljsGithubCss,
  "atom-one-dark": hljsAtomOneDarkCss,
  vs: hljsVsCss,
};

const BASE_STYLE_ID = "doc-theme-base-css";
const HLJS_STYLE_ID = "doc-hljs-theme-css";

/** document.css をアプリDOMに1回だけ注入する（印刷・モーダルサンプル用）。 */
export function ensureDocumentStyles(): void {
  if (document.getElementById(BASE_STYLE_ID)) return;
  const style = document.createElement("style");
  style.id = BASE_STYLE_ID;
  style.textContent = DOCUMENT_CSS;
  document.head.appendChild(style);
}

/** シンタックスハイライトテーマのCSSをアプリDOMに反映する（差し替え可）。 */
export function setHljsThemeStyle(theme: HighlightTheme): void {
  let style = document.getElementById(HLJS_STYLE_ID) as HTMLStyleElement | null;
  if (!style) {
    style = document.createElement("style");
    style.id = HLJS_STYLE_ID;
    document.head.appendChild(style);
  }
  style.textContent = HLJS_THEME_CSS[theme];
}
