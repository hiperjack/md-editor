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
import { buildStandaloneHtml, resolveTabMarkdown } from "./exporter";
import { buildPrintDocument } from "./print-doc";
import { showProgress } from "./progress";
import { t } from "./i18n";

/**
 * F2: PDF出力（Ctrl+P → 印刷プレビュー → Microsoft Print to PDF）。
 *
 * HTML出力と同一パイプラインで自己完結HTMLを組み立て、それを「非表示の
 * iframe」に流し込んで iframe 側で印刷する。メインウィンドウを print
 * メディアにしないため、印刷プレビュー表示中もエディタ本体は設定テーマの
 * 配色・UIのまま残る（以前はメインに @media print が適用され、背景が白く
 * 反転していた）。これにより「HTML出力とPDFの見た目が一致する」ことも
 * 引き続き保証する。
 *
 * 注: Ctrl+P は shortcuts.ts でのみ拾う（main.ts と二重に拾うと printActiveTab
 * が二重起動し、プレビューが回り続ける/ダイアログが再表示される）。加えて
 * printing フラグで二重起動を防御する（モーダル待ちの前に立てる）。
 */

const PRINT_FRAME_ID = "mdedit-print-frame";

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
 * 印刷用HTMLを非表示 iframe に読み込み、印刷プレビュー/ダイアログを開く。
 * - iframe は画面外に A4 相当のサイズで配置する（display:none/0サイズだと
 *   印刷プレビューが生成されないことがあるため）。
 * - 破棄はプレビューが閉じた後（afterprint）に行う。print() 直後に破棄すると
 *   プレビュー生成中に文書が消えてプレビューが回り続けるため。
 */
async function printViaIframe(html: string): Promise<void> {
  document.getElementById(PRINT_FRAME_ID)?.remove();

  const iframe = document.createElement("iframe");
  iframe.id = PRINT_FRAME_ID;
  iframe.setAttribute("aria-hidden", "true");
  iframe.style.cssText =
    "position:fixed;left:-10000px;top:0;width:794px;height:1123px;border:0;";
  document.body.appendChild(iframe);

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
  if (!win) {
    iframe.remove();
    throw new Error("print iframe has no contentWindow");
  }

  await new Promise<void>((resolve) => {
    let done = false;
    const finish = (): void => {
      if (done) return;
      done = true;
      iframe.remove();
      resolve();
    };
    // プレビューが閉じたら（印刷/キャンセル問わず）破棄する。
    win.addEventListener("afterprint", finish, { once: true });
    // afterprint が発火しない環境向けのフォールバック（iframe を残さない）。
    setTimeout(finish, 10 * 60 * 1000);
    win.focus();
    // print() は環境によりブロックする/しないが、破棄は afterprint 任せにする。
    win.print();
  });
}

export async function printActiveTab(editor: EditorHost): Promise<void> {
  if (printing) return;
  printing = true;
  try {
    const tab = store.getActive();
    if (!tab) return;
    // preview タブは元ソースを解決する（HTML出力と同じロジックを共用）。
    const { markdown, filePath } = await resolveTabMarkdown(editor, tab);
    if (markdown === null) return;

    // 印刷の向き（縦/横）を選ぶ。キャンセルなら印刷しない。
    const orientation = await askPrintOrientation();
    if (orientation === "cancel") return;

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
        fileTypeOfPath(filePath) === "mmd"
          ? await renderMermaidDocumentBody(extractMermaidSource(markdown), settings, {
              onMermaidProgress,
            })
          : await renderDocumentBody(markdown, settings, { onMermaidProgress });

      // iframe では相対パス画像を解決できないため data URI 化する。
      await embedLocalImages(body, filePath);

      // HTML出力と同一の自己完結HTMLを組み立て、印刷CSS（@page・改ページ等）を注入する。
      const standalone = buildStandaloneHtml({
        title: baseNameWithoutExt(filePath),
        settings,
        bodyHtml: body.innerHTML,
      });
      const printable = buildPrintDocument(standalone, orientation);

      progress.close();
      await printViaIframe(printable);
    } catch (e) {
      progress.close();
      console.error("printActiveTab failed:", e);
      await message(
        `${t("print.failed")}\n${e instanceof Error ? e.message : String(e)}`,
        { kind: "error" },
      );
    }
  } finally {
    printing = false;
  }
}
