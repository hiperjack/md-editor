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
    // ガントは themeVariables.fontSize が効かず既定11pxのままで他の図種より
    // 極端に小さい。タスク名・セクション名を揃え、バー高さも文字に合わせる。
    gantt: {
      fontSize: MERMAID_FONT_SIZE,
      sectionFontSize: MERMAID_FONT_SIZE,
      barHeight: 30,
      barGap: 6,
      // セクション名は固定 x=10 から描かれ、グラフ領域は leftPadding から始まる。
      // 既定75pxでは20pxフォントの日本語セクション名（5文字≈100px）が
      // グリッド線に重なるため、6文字+余白が収まる幅にする。
      leftPadding: 150,
    },
    // 設定では変えられないハードコード分の上書き。themeCSS は #id スコープで
    // 各SVG内に閉じる。&[aria-roledescription] で図種を限定する。
    // - ガント軸目盛: attr("font-size", 10) 固定 → CSSが表示属性に勝つ
    // - ガントタイトル: .titleText { font-size: 18px } 固定
    themeCSS: `
      &[aria-roledescription="gantt"] g.grid .tick text { font-size: ${MERMAID_FONT_SIZE}px; }
      &[aria-roledescription="gantt"] .titleText { font-size: 22px; }
    `,
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

/**
 * ganttのセクション名は固定 x=10 から描かれ、グラフ領域は leftPadding から
 * 始まる（initialize の既定150px）。長いセクション名はグリッド線・バーに
 * かぶるため、名前の長さから必要な左余白を見積もり、図ごとに init
 * ディレクティブで指定する。ユーザーが自分で %%{init...}%% を書いている
 * 図には手を出さない。
 */
function ganttLeftPaddingDirective(source: string): string | null {
  if (!/^\s*gantt\b/.test(source)) return null;
  if (source.includes("%%{")) return null;
  let maxLen = 0;
  for (const m of source.matchAll(/^[ \t]*section[ \t]+(.+)$/gm)) {
    // 全角=1文字ぶん、半角=0.5文字ぶんで幅を概算する
    let len = 0;
    for (const ch of m[1].trim()) len += (ch.codePointAt(0) ?? 0) > 0xff ? 1 : 0.5;
    maxLen = Math.max(maxLen, len);
  }
  if (maxLen === 0) return null;
  const px = Math.min(
    400,
    Math.max(150, Math.round(10 + maxLen * MERMAID_FONT_SIZE + 30)),
  );
  return `%%{init: {"gantt": {"leftPadding": ${px}}}}%%\n`;
}

/**
 * mermaid.render 出力の後処理。キャッシュ前に1回だけ行い、全経路
 * （エディタプレビュー・HTML出力・印刷・図ビューア）に効かせる。
 *
 * 1. dominant-baseline 属性を inline style にも複製する。
 *    エディタのプレビューパネルはDOMPurifyを通り、この属性は既定の許可リストに
 *    無く落とされる（象限図のタイトル・軸ラベルが位置決めに使っており、失われると
 *    上や左に見切れる）。style 属性は通るため、そちらにも書いておく。
 * 2. mindmapのcircleノード（root((x)) 等）のラベル中央寄せ。SVGラベルでは
 *    ラベルgがX方向 translate(0) のまま text-anchor が付かず、文字が右へ
 *    半分はみ出す（mermaid本体のバグ。既定の htmlLabels:true では露出しない）。
 *    矩形系ノードは translate(-w/2) で自前補正されるため対象外。
 */
function postProcessSvg(svg: string): string {
  const host = document.createElement("div");
  host.innerHTML = svg;
  const root = host.querySelector("svg");
  if (!root) return svg;
  for (const el of root.querySelectorAll<SVGElement>("[dominant-baseline]")) {
    el.style.dominantBaseline = el.getAttribute("dominant-baseline") ?? "";
  }
  // gantt: todayマーカーは日付範囲のチェックなしで描かれるため、todayが
  // チャート範囲外だと左余白（セクション名の領域）を貫く縦線になる。
  // プロット開始（g.grid の translate X）より左、または右端超は取り除く。
  if (root.getAttribute("aria-roledescription") === "gantt") {
    const grid = root.querySelector<SVGGElement>("g.grid");
    const line = root.querySelector<SVGLineElement>("g.today > line");
    if (grid && line) {
      const tm = /translate\(\s*([-\d.e]+)/.exec(
        grid.getAttribute("transform") ?? "",
      );
      const gridX = tm ? parseFloat(tm[1]) : 0;
      const x1 = parseFloat(line.getAttribute("x1") ?? "0");
      const width =
        parseFloat((root.getAttribute("viewBox") ?? "").split(/\s+/)[2]) || 0;
      if (x1 < gridX || x1 > width) line.remove();
    }
  }
  if (root.getAttribute("aria-roledescription") === "mindmap") {
    for (const label of root.querySelectorAll<SVGGElement>(
      ".mindmap-node > g.label",
    )) {
      const m = /translate\(\s*([-\d.e]+)/.exec(
        label.getAttribute("transform") ?? "",
      );
      if (!m || parseFloat(m[1]) !== 0) continue;
      const text = label.querySelector("text");
      if (text && !text.hasAttribute("text-anchor")) {
        text.setAttribute("text-anchor", "middle");
      }
    }
  }
  return host.innerHTML;
}

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
    const src = source.trim();
    const directive = ganttLeftPaddingDirective(src);
    const { svg } = await mermaid.render(id, directive ? directive + src : src);
    const fixed = postProcessSvg(svg);
    cachePut(key, fixed);
    return fixed;
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
