/**
 * プレゼン（スライド）のPDF出力・HTML出力。
 *
 * どちらも「HTML出力と同一の文書HTML → parseSlides でスライド分割 →
 * buildCanvas で16:9キャンバス化」までを共有する（＝プレゼンプレビューと
 * 同じ見た目が出力される）。fitBody の zoom は実レイアウトが必要なため、
 * 画面外の測定用コンテナへ一時マウントして計算し、inline style として
 * 焼き込んでから直列化する。
 *
 * - PDF: スライド1枚 = 16:9横1ページ（@page 338.7mm×190.5mm ≒ 1280×720px
 *   @96dpi）として連結し、既存の printViaIframe（印刷プレビュー →
 *   Microsoft Print to PDF）へ流す。ページ範囲指定は印刷ダイアログ標準の
 *   「ページ指定」に任せる。PDFはスクロールできないため、縮小下限なし
 *   （fitBody minZoom=0）で全内容を収める。
 * - HTML: 全スライド＋最小ビューアJS（キー/クリック送り・ウィンドウ追従
 *   スケール）を同梱した自己完結HTMLを書き出す。こちらは画面と同じ縮小下限
 *   0.55 を維持し、あふれた本文は枠内スクロールのまま残す。
 */
import { invoke } from "@tauri-apps/api/core";
import { save as saveDialog, message } from "@tauri-apps/plugin-dialog";
import { store } from "./store";
import type { EditorHost } from "./editor";
import { docTheme, type DocSettings } from "./theme";
import { DOCUMENT_CSS, HLJS_THEME_CSS } from "./doc-styles";
import { resolveTabMarkdown, renderExportPreview } from "./exporter";
import { printViaIframe } from "./print";
import { parseSlides, buildCanvas, fitBody, CANVAS_W, CANVAS_H } from "./presentation";
import { showProgress } from "./progress";
import { settings as appSettings } from "./settings";
import { t } from "./i18n";
// スライド描画CSSをテキストとして同梱する（アプリへの注入は presentation.ts が行う）。
import presentationCss from "./styles/presentation.css?raw";

function isTauriContext(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function baseNameWithoutExt(filePath: string | null): string {
  if (!filePath) return "Untitled";
  const i = Math.max(filePath.lastIndexOf("/"), filePath.lastIndexOf("\\"));
  const base = i >= 0 ? filePath.slice(i + 1) : filePath;
  const dot = base.lastIndexOf(".");
  return dot > 0 ? base.slice(0, dot) : base;
}

/** プレゼンHTMLの既定保存パス: 元mdの隣に <basename>_slides.html。 */
function defaultSlidesHtmlPath(filePath: string | null): string {
  if (!filePath) return "Untitled_slides.html";
  const dot = filePath.lastIndexOf(".");
  const sep = Math.max(filePath.lastIndexOf("/"), filePath.lastIndexOf("\\"));
  return (dot > sep ? filePath.slice(0, dot) : filePath) + "_slides.html";
}

/**
 * 文書HTMLをスライドキャンバスの配列へ直列化する。
 * 画面外の測定用コンテナへ一時マウントし、画像ロード → レイアウト確定を
 * 待ってから fitBody で zoom を焼き込む（zoom は inline style として残る）。
 */
async function buildSlideCanvases(
  html: string,
  minZoom?: number,
): Promise<HTMLElement[]> {
  const { template, slides } = parseSlides(html);
  const canvases = slides.map((s) => buildCanvas(s, template));

  const host = document.createElement("div");
  host.style.cssText = "position:fixed;left:-20000px;top:0;";
  for (const c of canvases) {
    const wrap = document.createElement("div");
    wrap.style.cssText = `position:relative;width:${CANVAS_W}px;height:${CANVAS_H}px;`;
    wrap.appendChild(c);
    host.appendChild(wrap);
  }
  document.body.appendChild(host);

  try {
    // 画像（data URI 含む）のデコード完了を待つ。失敗もレイアウト確定として扱う。
    await Promise.all(
      Array.from(host.querySelectorAll("img")).map((img) =>
        img.complete
          ? Promise.resolve()
          : new Promise<void>((r) => {
              img.addEventListener("load", () => r(), { once: true });
              img.addEventListener("error", () => r(), { once: true });
            }),
      ),
    );
    await new Promise<void>((r) =>
      requestAnimationFrame(() => requestAnimationFrame(() => r())),
    );
    for (const c of canvases) fitBody(c, minZoom);
  } finally {
    for (const c of canvases) c.remove();
    host.remove();
  }
  return canvases;
}

/** 出力HTML/印刷HTMLで共有する <style> 群（文書CSS + ハイライト + スライドCSS）。 */
function slideStyles(settings: DocSettings): string {
  return `${DOCUMENT_CSS}
${HLJS_THEME_CSS[settings.theme.highlightTheme]}
${presentationCss}`;
}

/* ───────────────────────── PDF 出力 ───────────────────────── */

/**
 * スライドPDF用の印刷CSS。
 * 1280×720px は 96dpi でちょうど 13.333×7.5in = PowerPoint 標準の16:9ページ
 * （338.7mm×190.5mm）に一致する。ドライバが用紙サイズを強制する環境では
 * A4横などにレターボックスで収まる（内容は欠けない）。
 */
const PRES_PRINT_CSS = `
@page { size: 338.7mm 190.5mm; margin: 0; }
html, body { margin: 0; padding: 0; }
.pres-page {
  position: relative;
  width: ${CANVAS_W}px;
  height: ${CANVAS_H}px;
  overflow: hidden;
  page-break-after: always;
  break-after: page;
}
.pres-page:last-child { page-break-after: auto; break-after: auto; }
/* 測定用の中央寄せ transform は不要。ページ左上に等倍で敷く。 */
.pres-page .slide-canvas { position: absolute; left: 0; top: 0; transform: none; }
/* スライドはテーマ背景ごと印刷する（通常文書の「背景は白」方針とは逆）。 */
.pres-page, .pres-page * {
  -webkit-print-color-adjust: exact;
  print-color-adjust: exact;
}
`;

function buildPresentationPrintHtml(opts: {
  title: string;
  settings: DocSettings;
  canvases: HTMLElement[];
}): string {
  const pages = opts.canvases
    .map((c) => `<div class="pres-page">${c.outerHTML}</div>`)
    .join("\n");
  const lang = appSettings.getEffectiveLang();
  return `<!DOCTYPE html>
<html lang="${lang}">
<head>
<meta charset="utf-8">
<title>${escapeHtml(opts.title)}</title>
<style>
${slideStyles(opts.settings)}
${PRES_PRINT_CSS}
</style>
</head>
<body>
${pages}
</body>
</html>
`;
}

let exporting = false;

/**
 * アクティブタブのプレゼンを「スライド1枚=1ページ」のPDFとして印刷する。
 * mdタブ・プレゼン/HTMLプレビュータブのどちらからでも実行できる。
 */
export async function exportPresentationPdf(editor: EditorHost): Promise<void> {
  if (exporting) return;
  exporting = true;
  try {
    const tab = store.getActive();
    if (!tab) return;
    const { markdown, filePath } = await resolveTabMarkdown(editor, tab);
    if (markdown === null) return;

    const { html } = await renderExportPreview(filePath, markdown);
    const progress = showProgress(t("presPdf.preparing"));
    try {
      // PDFはスクロール不可のため縮小下限なしで全内容を収める。
      const canvases = await buildSlideCanvases(html, 0);
      if (canvases.length === 0) return;
      const printable = buildPresentationPrintHtml({
        title: baseNameWithoutExt(filePath),
        settings: docTheme.get(),
        canvases,
      });
      progress.close();
      await printViaIframe(printable);
    } catch (e) {
      progress.close();
      console.error("exportPresentationPdf failed:", e);
      await message(
        `${t("presPdf.failed")}\n${e instanceof Error ? e.message : String(e)}`,
        { kind: "error" },
      );
    }
  } finally {
    exporting = false;
  }
}

/* ───────────────────────── HTML 出力 ───────────────────────── */

/** ビューアのCSS。キャンバスの中央寄せ transform はビューアJSが設定する。 */
const VIEWER_CSS = `
html, body { margin: 0; height: 100%; overflow: hidden; background: #15181d; }
.pres-slide { position: fixed; inset: 0; }
.pres-slide .slide-canvas { box-shadow: 0 4px 24px rgba(0, 0, 0, 0.4); border-radius: 4px; }
#pres-pageno {
  position: fixed; right: 14px; bottom: 10px; z-index: 10;
  color: #9aa3ad; font: 12px system-ui, sans-serif; user-select: none;
}
`;

/**
 * ビューアJS。←→/PageUp/PageDown/Space/Home/End とクリック（右半分=次、
 * 左半分=前）でスライドを送る。枠内スクロール（.scrollable）やリンクの
 * クリックは送りに使わない。ウィンドウサイズへは resize で追従する。
 */
const VIEWER_JS = `
(function () {
  var W = ${CANVAS_W}, H = ${CANVAS_H};
  var slides = Array.prototype.slice.call(document.querySelectorAll(".pres-slide"));
  var pageNo = document.getElementById("pres-pageno");
  var i = 0;
  function scale() {
    var s = Math.min(window.innerWidth / W, window.innerHeight / H);
    slides.forEach(function (sl) {
      var c = sl.querySelector(".slide-canvas");
      if (c) c.style.transform = "translate(-50%, -50%) scale(" + s + ")";
    });
  }
  function show(n) {
    i = Math.max(0, Math.min(n, slides.length - 1));
    slides.forEach(function (sl, k) { sl.style.display = k === i ? "" : "none"; });
    if (pageNo) pageNo.textContent = (i + 1) + " / " + slides.length;
  }
  document.addEventListener("keydown", function (e) {
    if (e.key === "ArrowRight" || e.key === "PageDown" || e.key === " ") {
      e.preventDefault(); show(i + 1);
    } else if (e.key === "ArrowLeft" || e.key === "PageUp") {
      e.preventDefault(); show(i - 1);
    } else if (e.key === "Home") { e.preventDefault(); show(0); }
    else if (e.key === "End") { e.preventDefault(); show(slides.length - 1); }
  });
  document.addEventListener("click", function (e) {
    var t = e.target;
    if (t && t.closest && t.closest(".slide-body.scrollable, a, #pres-pageno")) return;
    show(e.clientX > window.innerWidth / 2 ? i + 1 : i - 1);
  });
  window.addEventListener("resize", scale);
  scale();
  show(0);
})();
`;

function buildPresentationViewerHtml(opts: {
  title: string;
  settings: DocSettings;
  canvases: HTMLElement[];
}): string {
  const slides = opts.canvases
    .map((c) => `<div class="pres-slide">${c.outerHTML}</div>`)
    .join("\n");
  const lang = appSettings.getEffectiveLang();
  return `<!DOCTYPE html>
<html lang="${lang}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${escapeHtml(opts.title)}</title>
<style>
${slideStyles(opts.settings)}
${VIEWER_CSS}
</style>
</head>
<body>
${slides}
<div id="pres-pageno"></div>
<script>
${VIEWER_JS}
</script>
</body>
</html>
`;
}

/**
 * アクティブタブのプレゼンを自己完結HTML（ビューア同梱）として書き出す。
 * 画面と同じ縮小下限を使い、あふれた本文の枠内スクロールも保たれる。
 */
export async function exportPresentationAsHtml(
  editor: EditorHost,
): Promise<void> {
  if (!isTauriContext()) {
    console.warn("exportPresentationAsHtml: Tauri context not available");
    return;
  }
  if (exporting) return;
  exporting = true;
  try {
    const tab = store.getActive();
    if (!tab) return;
    const { markdown, filePath } = await resolveTabMarkdown(editor, tab);
    if (markdown === null) return;

    const picked = await saveDialog({
      title: t("presHtml.dialogTitle"),
      filters: [{ name: "HTML", extensions: ["html"] }],
      defaultPath: defaultSlidesHtmlPath(filePath),
    });
    if (!picked) return;

    const { html } = await renderExportPreview(filePath, markdown);
    const progress = showProgress(t("export.rendering"));
    try {
      const canvases = await buildSlideCanvases(html);
      const out = buildPresentationViewerHtml({
        title: baseNameWithoutExt(filePath),
        settings: docTheme.get(),
        canvases,
      });
      await invoke<void>("write_file", { path: picked, content: out });
    } catch (e) {
      console.error("exportPresentationAsHtml failed:", e);
      await message(
        `${t("export.failed")}\n${e instanceof Error ? e.message : String(e)}`,
        { kind: "error" },
      );
    } finally {
      progress.close();
    }
  } finally {
    exporting = false;
  }
}
