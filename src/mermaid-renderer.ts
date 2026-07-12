/**
 * Mermaid描画レイヤ。
 *
 * - mermaid本体（minifyで1MB超）は動的importとし、図が初めて必要になった
 *   ときだけロードする。図のないmdの編集では一切ロードされない。
 * - 配色＋ソース文字列をキーにSVGをキャッシュし、変わっていない図は再描画しない
 *   （タブ切替やHTML出力時にもキャッシュが効く）。
 * - エディタ内プレビュー（Crepeコードブロックの renderPreview）は800msの
 *   デバウンスで再描画し、構文エラー中は前回の正常なSVG表示を維持する。
 *   一度も正常描画できていないブロックだけはエラーを表示する（「準備中」の
 *   まま固まると壊れていることに気づけないため）。
 */

import { t } from "./i18n";

type MermaidModule = typeof import("mermaid").default;

/** Mermaid図のフォントサイズ（px）。既定の16pxは小さいため拡大（固定）。 */
const MERMAID_FONT_SIZE = 20;

let mermaidPromise: Promise<MermaidModule> | null = null;

function getMermaid(): Promise<MermaidModule> {
  if (!mermaidPromise) {
    mermaidPromise = import("mermaid").then((m) => m.default);
  }
  return mermaidPromise;
}

/** 現在のMermaid配色。main.ts が解決済み（light|dark）の値で更新する。 */
let colorScheme: "light" | "dark" = "light";
/** 直近に mermaid.initialize した配色。変わったら再初期化する。 */
let initializedScheme: "light" | "dark" | null = null;

function initMermaid(mermaid: MermaidModule, scheme: "light" | "dark"): void {
  if (initializedScheme === scheme) return;
  mermaid.initialize({
    startOnLoad: false,
    securityLevel: "strict",
    // light → "default"（白背景向け）, dark → "dark"（暗背景向け）
    theme: scheme === "dark" ? "dark" : "default",
    // エディタのプレビューパネルはDOMPurifyを通すため、foreignObjectを
    // 使うHTMLラベルは除去されてしまう。SVGテキストラベルで描画する。
    // ルートレベルの htmlLabels が全図種に優先適用される（diagram別は非推奨）。
    htmlLabels: false,
    // themeVariables.fontSize は flowchart/class/state/er 等で有効で、
    // Mermaidがこのサイズを前提にノード寸法・配置を計算するためレイアウトは崩れない。
    themeVariables: { fontSize: `${MERMAID_FONT_SIZE}px` },
  });
  initializedScheme = scheme;
}

/**
 * Mermaid配色を設定する。変更があれば true を返す（呼び出し側が再描画判断に使う）。
 * キャッシュは配色込みのキーで保持するため、ここではクリアしない。
 */
export function setMermaidColorScheme(scheme: "light" | "dark"): boolean {
  if (scheme === colorScheme) return false;
  colorScheme = scheme;
  return true;
}

const MAX_CACHE_ENTRIES = 200;
const svgCache = new Map<string, string>();
let renderSeq = 0;

/** 配色で見た目が変わるため、キャッシュキーに配色を含める。 */
function cacheKey(source: string, scheme: "light" | "dark"): string {
  return `${scheme}:${source.trim()}`;
}

function cachePut(key: string, svg: string): void {
  if (svgCache.size >= MAX_CACHE_ENTRIES) {
    const oldest = svgCache.keys().next().value;
    if (oldest !== undefined) svgCache.delete(oldest);
  }
  svgCache.set(key, svg);
}

/**
 * MermaidソースをSVG文字列に変換する（キャッシュあり）。構文エラー時はthrow。
 * schemeOverride を渡すと、その配色で描画する（HTML出力・印刷・プレビューで
 * 文書背景に合わせるのに使う）。省略時はエディタの現在配色。
 */
export async function renderMermaidSvg(
  source: string,
  schemeOverride?: "light" | "dark",
): Promise<string> {
  const scheme = schemeOverride ?? colorScheme;
  const key = cacheKey(source, scheme);
  const cached = svgCache.get(key);
  if (cached) return cached;
  const mermaid = await getMermaid();
  initMermaid(mermaid, scheme);
  const id = `mmd-render-${++renderSeq}`;
  try {
    const { svg } = await mermaid.render(id, source.trim());
    cachePut(key, svg);
    return svg;
  } catch (e) {
    // mermaidは失敗時に一時要素をbodyへ残すことがあるため掃除する
    document.getElementById(id)?.remove();
    document.getElementById(`d${id}`)?.remove();
    throw e;
  }
}

// ── エディタ内プレビュー（Crepe renderPreview） ─────────────

const PREVIEW_DEBOUNCE_MS = 800;

/**
 * applyの新旧判定用シーケンス。
 * 入力途中の古い描画結果が、後から完了して新しい表示を上書きしないようにする。
 */
let applySeq = 0;
let lastAppliedSeq = 0;
const pendingTimers = new Map<string, number>();

function buildPreviewFigure(svg: string): HTMLElement {
  const el = document.createElement("div");
  el.className = "mermaid-preview";
  el.innerHTML = svg;
  // mermaid は useMaxWidth により <svg width="100%" style="max-width:Npx"> を出力する。
  // インラインの width:100% / max-width が残ると、表示幅モード(native=原寸)を CSS の
  // max-width で制御できない（インラインstyleが優先されエディタ幅に追従してしまう）。
  // 自然幅を固定幅として与え、レスポンシブ指定を外して、fit/native の出し分けは
  // CSS の max-width(100% / none)に委ねる。この正規化はエディタ内プレビュー専用パス
  // (buildPreviewFigure)のみで行い、HTML出力・印刷・図ビューアの SVG には影響しない。
  const svgEl = el.querySelector<SVGSVGElement>("svg");
  if (svgEl) {
    const naturalWidth =
      parseFloat(svgEl.style.maxWidth) || svgEl.viewBox?.baseVal?.width || 0;
    if (naturalWidth > 0) {
      svgEl.style.width = `${naturalWidth}px`;
      svgEl.style.maxWidth = "";
      svgEl.removeAttribute("width");
    }
  }
  return el;
}

/** 描画失敗時のエディタ内エラー表示（初回描画に失敗したブロック専用）。 */
function buildPreviewError(e: unknown): HTMLElement {
  const el = document.createElement("div");
  el.className = "mermaid-preview-error";
  const msg = e instanceof Error ? e.message : String(e);
  el.textContent = `${t("cb.previewError")}: ${msg}`;
  return el;
}

/**
 * src を現在表示中のコードブロックの状態。
 * applyPreview にはブロックの識別子が無いため、DOMから該当ブロックを探して
 * 判定する。CodeMirror の textContent は改行を含まないため空白を除いて比べる。
 * - "no-block": src を表示中のブロックが無い。入力が先へ進んだ中間状態の
 *   結果か、ブロックが破棄された後。どちらも表示へ反映してはいけない
 *   （中間状態のエラーで維持中の正常な図を上書きしない）。
 * - "has-figure": 前回の正常な図（SVG）が表示中 → 維持する。
 * - "no-figure": 一度も描画できていない（準備中/エラー表示中） → エラーを出す。
 */
function blockStateOf(src: string): "no-block" | "has-figure" | "no-figure" {
  const norm = src.replace(/\s+/g, "");
  for (const block of document.querySelectorAll(".milkdown-code-block")) {
    const code = (
      block.querySelector(".cm-content")?.textContent ?? ""
    ).replace(/\s+/g, "");
    if (code !== norm) continue;
    return block.querySelector(".preview svg") ? "has-figure" : "no-figure";
  }
  return "no-block";
}

/**
 * Crepeコードブロックの renderPreview から呼ぶ。
 * - キャッシュ済み → 同期的に図を返す（タブ切替・再マウントは即時表示）
 * - 未キャッシュ → デバウンス後に描画して applyPreview で差し替える。
 *   描画エラー時、前回の正常表示があるブロックは何もしない＝表示維持
 *   （編集途中のバタつき防止）。一度も描画できていないブロックは
 *   「準備中」のまま固まってしまうため、エラーを表示して気づけるようにする。
 */
export function mermaidCodePreview(
  content: string,
  applyPreview: (value: HTMLElement) => void,
): HTMLElement | null | undefined {
  const src = content.trim();
  if (!src) return null;

  const seq = ++applySeq;
  // renderMermaidSvg と同じ配色込みキーで引く（素のsrcだとヒットせず常に再描画になる）
  const cached = svgCache.get(cacheKey(src, colorScheme));
  if (cached) {
    lastAppliedSeq = seq;
    return buildPreviewFigure(cached);
  }

  const prev = pendingTimers.get(src);
  if (prev !== undefined) window.clearTimeout(prev);
  const timer = window.setTimeout(() => {
    pendingTimers.delete(src);
    renderMermaidSvg(src)
      .then((svg) => {
        if (seq > lastAppliedSeq) {
          lastAppliedSeq = seq;
          applyPreview(buildPreviewFigure(svg));
        }
      })
      .catch((e) => {
        // 入力途中の構文エラー: 前回の正常表示があれば維持する
        if (seq > lastAppliedSeq && blockStateOf(src) === "no-figure") {
          lastAppliedSeq = seq;
          applyPreview(buildPreviewError(e));
        }
      });
  }, PREVIEW_DEBOUNCE_MS);
  pendingTimers.set(src, timer);

  // undefined を返すとパネルは前回内容を保持して待つ（初回はローディング表示）
  return undefined;
}

// 配色変更時のエディタ内プレビュー反映は、Crepe(Vue)管理下のDOMを直接書き換えると
// Vue再描画で戻されるため行わない。代わりに editor.recreateMermaidTabs() で
// 図を含むタブを作り直す（mermaidCodePreview 経由で新配色で再描画される）。
