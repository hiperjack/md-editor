import { message } from "@tauri-apps/plugin-dialog";
import { store } from "./store";
import { askPrintOrientation } from "./modal";
import type { EditorHost } from "./editor";
import { docTheme } from "./theme";
import {
  renderDocumentBody,
  renderMermaidDocumentBody,
  type MermaidProgress,
} from "./render-pipeline";
import { fileTypeOfPath, extractMermaidSource } from "./mmd";
import { embedLocalImages } from "./embed-images";
import { buildStandaloneHtml } from "./exporter";
import { buildPrintDocument } from "./print-doc";
import { showProgress } from "./progress";
import { t } from "./i18n";

/**
 * F2: PDF出力（Ctrl+P → 印刷ダイアログ → Microsoft Print to PDF）。
 *
 * HTML出力と同一パイプラインで自己完結HTMLを組み立て、それを「非表示の
 * iframe」に流し込んで iframe 側で印刷する。メインウィンドウを print
 * メディアにしないため、印刷ダイアログ表示中もエディタ本体は設定テーマの
 * 配色・UIのまま背後に残る（以前はメインに @media print が適用され、
 * 背景が白く反転していた）。
 * これにより「HTML出力とPDFの見た目が一致する」ことも引き続き保証する。
 */

let printing = false;

/** ファイルパスから拡張子を除いた名前（PDFの既定ファイル名・文書タイトル用）。 */
function baseNameWithoutExt(filePath: string | null): string {
  if (!filePath) return "Untitled";
  const i = Math.max(filePath.lastIndexOf("/"), filePath.lastIndexOf("\\"));
  const base = i >= 0 ? filePath.slice(i + 1) : filePath;
  const dot = base.lastIndexOf(".");
  return dot > 0 ? base.slice(0, dot) : base;
}

/**
 * 印刷用HTMLを非表示 iframe に読み込み、印刷ダイアログを開く。
 * iframe は画面外に配置し（display:none では印刷されないため）、
 * ダイアログが閉じた後に破棄する。
 */
async function printViaIframe(html: string): Promise<void> {
  const iframe = document.createElement("iframe");
  iframe.setAttribute("aria-hidden", "true");
  // display:none / visibility:hidden は印刷対象から外れるため、画面外配置にする。
  iframe.style.cssText =
    "position:absolute;width:0;height:0;border:0;left:-9999px;top:0;";
  document.body.appendChild(iframe);
  try {
    await new Promise<void>((resolve, reject) => {
      iframe.addEventListener("load", () => resolve(), { once: true });
      iframe.addEventListener(
        "error",
        () => reject(new Error("print iframe load failed")),
        { once: true },
      );
      iframe.srcdoc = html;
    });
    // レイアウト確定を待ってから印刷する。
    await new Promise<void>((r) =>
      requestAnimationFrame(() => requestAnimationFrame(() => r())),
    );
    const win = iframe.contentWindow;
    if (!win) throw new Error("print iframe has no contentWindow");
    win.focus();
    // print() は印刷ダイアログが閉じるまでブロックする。
    win.print();
  } finally {
    iframe.remove();
  }
}

export async function printActiveTab(editor: EditorHost): Promise<void> {
  if (printing) return;
  const tab = store.getActive();
  if (!tab) return;
  const markdown = editor.getMarkdown(tab.id);
  if (markdown === null) return;

  // 印刷の向き（縦/横）を選ぶ。キャンセルなら印刷しない。
  const orientation = await askPrintOrientation();
  if (orientation === "cancel") return;

  printing = true;
  const settings = docTheme.get();
  const progress = showProgress(t("print.preparing"));
  const onMermaidProgress: MermaidProgress = (done, total) => {
    progress.update(
      t("export.converting")
        .replace("{done}", String(done))
        .replace("{total}", String(total)),
    );
  };

  try {
    const body =
      fileTypeOfPath(tab.filePath) === "mmd"
        ? await renderMermaidDocumentBody(extractMermaidSource(markdown), settings, {
            onMermaidProgress,
          })
        : await renderDocumentBody(markdown, settings, { onMermaidProgress });

    // iframe では相対パス画像を解決できないため data URI 化する。
    await embedLocalImages(body, tab.filePath);

    // HTML出力と同一の自己完結HTMLを組み立て、印刷CSS（@page・改ページ等）を注入する。
    const standalone = buildStandaloneHtml({
      title: baseNameWithoutExt(tab.filePath),
      settings,
      bodyHtml: body.innerHTML,
    });
    const printable = buildPrintDocument(standalone, orientation);

    progress.close();
    await printViaIframe(printable);
  } catch (e) {
    console.error("printActiveTab failed:", e);
    progress.close();
    await message(
      `${t("print.failed")}\n${e instanceof Error ? e.message : String(e)}`,
      { kind: "error" },
    );
  } finally {
    printing = false;
  }
}
