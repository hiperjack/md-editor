import MarkdownIt from "markdown-it";
import anchor from "markdown-it-anchor";
import toc from "markdown-it-toc-done-right";
import githubAlerts from "markdown-it-github-alerts";
import footnote from "markdown-it-footnote";
import { type DocSettings, isLightColor } from "./theme";
import { renderMermaidSvg } from "./mermaid-renderer";
import {
  ensureBlankLineBeforeTables,
  ensureBlankLineBeforeFootnoteDefs,
} from "./md-normalize";
import { underlineTagPlugin } from "./markdown-it-underline";
import { textColorTagPlugin } from "./markdown-it-text-color";
import { highlightTagPlugin } from "./markdown-it-highlight";
import { supSubTagPlugin } from "./markdown-it-supsub";
import { mathPlugin } from "./markdown-it-math";

/**
 * 出力用レンダリングパイプライン（markdown → 文書HTML）。
 *
 * HTML出力・PDF印刷・設定モーダル内サンプルの3経路がこの1本を通ることで、
 * 「同じ設定なら同じ見た目」を保証する。エディタ（Milkdown WYSIWYG）は
 * remark系で別系統だが、breaks（単一改行=改行）等の方言をここで揃える。
 *
 * パイプライン:
 *   md → markdown-it（anchor + toc + github-alerts + task-list + hljs）
 *      → mermaidブロックをプレースホルダ化 → mermaid.render でSVGに差し替え
 */

export type MermaidProgress = (done: number, total: number) => void;

export type RenderOptions = {
  /** Mermaid変換の進捗通知（HTML出力時のプログレス表示用） */
  onMermaidProgress?: MermaidProgress;
};

/** 見出しスラッグ。日本語等の非ASCII文字をそのまま残す（anchor/toc共用）。 */
function slugify(s: string): string {
  return s
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "-")
    .replace(/[^\p{L}\p{N}\-_]/gu, "");
}

/**
 * GFMタスクリスト（- [ ] / - [x]）をチェックボックスに変換する小型プラグイン。
 * 依存の markdown-it-task-lists は古くメンテされていないため自前実装とする。
 */
function taskListPlugin(md: MarkdownIt): void {
  md.core.ruler.after("inline", "doc-task-list", (state) => {
    const tokens = state.tokens;
    for (let i = 2; i < tokens.length; i++) {
      const inline = tokens[i];
      if (inline.type !== "inline" || !inline.children?.length) continue;
      if (tokens[i - 1].type !== "paragraph_open") continue;
      if (tokens[i - 2].type !== "list_item_open") continue;
      const first = inline.children[0];
      if (first.type !== "text") continue;
      const m = /^\[( |x|X)\] /.exec(first.content);
      if (!m) continue;
      const checked = m[1].toLowerCase() === "x";
      first.content = first.content.slice(m[0].length);
      const checkbox = new state.Token("html_inline", "", 0);
      checkbox.content = `<input type="checkbox" disabled${checked ? " checked" : ""}> `;
      inline.children.unshift(checkbox);
      tokens[i - 2].attrJoin("class", "task-list-item");
    }
  });
}

/** 表を横スクロール可能なラッパで包む（document.cssの .table-wrap と対）。 */
function tableWrapPlugin(md: MarkdownIt): void {
  md.renderer.rules.table_open = () => '<div class="table-wrap">\n<table>\n';
  md.renderer.rules.table_close = () => "</table>\n</div>\n";
}

/** ```mermaid フェンスをプレースホルダdivへ変換する。 */
function mermaidFencePlugin(md: MarkdownIt): void {
  const defaultFence =
    md.renderer.rules.fence ??
    ((tokens, idx, options, _env, self) =>
      self.renderToken(tokens, idx, options));
  md.renderer.rules.fence = (tokens, idx, options, env, self) => {
    const token = tokens[idx];
    const lang = token.info.trim().split(/\s+/)[0]?.toLowerCase() ?? "";
    if (lang === "mermaid") {
      return `<div class="mermaid-block" data-source="${md.utils.escapeHtml(token.content)}"></div>\n`;
    }
    return defaultFence(tokens, idx, options, env, self);
  };
}

type Hljs = typeof import("highlight.js/lib/common").default;
let hljsPromise: Promise<Hljs> | null = null;

function getHljs(): Promise<Hljs> {
  if (!hljsPromise) {
    hljsPromise = import("highlight.js/lib/common").then((m) => m.default);
  }
  return hljsPromise;
}

/** TOCマーカー（[[toc]] / [toc]）が文書に含まれているか。 */
function hasTocMarker(markdown: string): boolean {
  return /^[ \t]*(\[\[toc\]\]|\[toc\])[ \t]*$/im.test(markdown);
}

function buildMarkdownIt(settings: DocSettings, hljs: Hljs | null): MarkdownIt {
  const md = new MarkdownIt({
    // エディタ（remark）はraw HTMLをエスケープして扱うため、出力も html:false で揃える。
    // 配布HTMLへのスクリプト混入防止も兼ねる。
    html: false,
    linkify: false,
    // エディタは単一改行を改行として扱う（remark-breaks）ため、出力も合わせる
    breaks: true,
    highlight: (code, lang): string => {
      if (hljs && lang && hljs.getLanguage(lang)) {
        try {
          return hljs.highlight(code, { language: lang, ignoreIllegals: true }).value;
        } catch {
          // ハイライト失敗時はプレーン表示にフォールバック
        }
      }
      return "";
    },
  });
  md.use(anchor, { slugify });
  // TOCプラグインは常時有効（明示の [[toc]] マーカーは設定によらず展開する）
  md.use(toc, { slugify, listType: "ol", level: [1, 2, 3] });
  if (settings.decorations.callouts) {
    md.use(githubAlerts);
  }
  // 脚注 [^1]（GitHub / Obsidian 互換）。エディタ（remark-gfm）は元々保持できる。
  md.use(footnote);
  // 数式 $…$ / $$…$$（エディタの Crepe LaTeX 機能と同じ remark-math 記法）。
  mathPlugin(md);
  underlineTagPlugin(md);
  textColorTagPlugin(md);
  highlightTagPlugin(md);
  supSubTagPlugin(md);
  taskListPlugin(md);
  tableWrapPlugin(md);
  mermaidFencePlugin(md);
  return md;
}

/** Mermaidプレースホルダを実SVGに差し替える。エラー時はソースを残したエラー表示。 */
async function resolveMermaidBlocks(
  container: HTMLElement,
  scheme: "light" | "dark",
  onProgress?: MermaidProgress,
): Promise<void> {
  const blocks = Array.from(
    container.querySelectorAll<HTMLElement>("div.mermaid-block"),
  );
  const total = blocks.length;
  if (total === 0) return;
  let done = 0;
  onProgress?.(0, total);
  for (const block of blocks) {
    const source = block.dataset.source ?? "";
    try {
      const svg = await renderMermaidSvg(source, scheme);
      const figure = document.createElement("figure");
      figure.className = "mermaid-figure";
      figure.innerHTML = svg;
      block.replaceWith(figure);
    } catch (e) {
      const errBox = document.createElement("pre");
      errBox.className = "mermaid-error";
      errBox.textContent = `Mermaid render error: ${e instanceof Error ? e.message : String(e)}\n\n${source}`;
      block.replaceWith(errBox);
    }
    done++;
    onProgress?.(done, total);
  }
}

/**
 * markdownを文書HTML（.document の中身）へレンダリングする。
 * 戻り値は切り離されたコンテナ要素。呼び出し側で innerHTML を取り出すか、
 * そのままDOMに挿入する。
 */
export async function renderDocumentBody(
  markdown: string,
  settings: DocSettings,
  opts: RenderOptions = {},
): Promise<HTMLDivElement> {
  let src = markdown;
  if (settings.decorations.autoToc && !hasTocMarker(src)) {
    src = `[[toc]]\n\n${src}`;
  }
  // リストや段落の直後に空行なしで置かれた表を、表として認識できるよう空行を補う。
  src = ensureBlankLineBeforeTables(src);
  // 段落の直後に空行なしで置かれた脚注定義（[^1]: …）も同様に補う。
  src = ensureBlankLineBeforeFootnoteDefs(src);

  // コードフェンスが存在するときだけhighlight.jsをロードする
  const needHljs = /(^|\n)\s*(`{3,}|~{3,})/.test(src);
  const hljs = needHljs ? await getHljs() : null;

  const md = buildMarkdownIt(settings, hljs);
  const html = md.render(src);

  const container = document.createElement("div");
  container.innerHTML = html;
  // Mermaid図は文書背景の明暗に合わせて配色する（白背景→ライト図）
  const scheme = isLightColor(settings.theme.bgColor) ? "light" : "dark";
  await resolveMermaidBlocks(container, scheme, opts.onMermaidProgress);
  return container;
}

/**
 * Mermaidソース単体（.mmd）を文書HTMLへレンダリングする。
 * SVG1枚を中央配置した構成になる。
 */
export async function renderMermaidDocumentBody(
  source: string,
  settings: DocSettings,
  opts: RenderOptions = {},
): Promise<HTMLDivElement> {
  const container = document.createElement("div");
  const scheme = isLightColor(settings.theme.bgColor) ? "light" : "dark";
  opts.onMermaidProgress?.(0, 1);
  try {
    const svg = await renderMermaidSvg(source, scheme);
    const figure = document.createElement("figure");
    figure.className = "mermaid-figure mmd-single";
    figure.innerHTML = svg;
    container.appendChild(figure);
  } catch (e) {
    const errBox = document.createElement("pre");
    errBox.className = "mermaid-error";
    errBox.textContent = `Mermaid render error: ${e instanceof Error ? e.message : String(e)}\n\n${source}`;
    container.appendChild(errBox);
  }
  opts.onMermaidProgress?.(1, 1);
  return container;
}
