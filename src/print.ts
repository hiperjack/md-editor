import { message } from "@tauri-apps/plugin-dialog";
import { store } from "./store";
import { askPrintOrientation } from "./modal";
import type { EditorHost } from "./editor";
import { docTheme, docThemeCssVars, docModifierClasses } from "./theme";
import {
  renderDocumentBody,
  renderMermaidDocumentBody,
  type MermaidProgress,
} from "./render-pipeline";
import { fileTypeOfPath, extractMermaidSource } from "./mmd";
import { embedLocalImages } from "./embed-images";
import { ensureDocumentStyles, setHljsThemeStyle } from "./doc-styles";
import { showProgress } from "./progress";
import { t } from "./i18n";

/**
 * F2: PDF出力（Ctrl+P → 印刷ダイアログ → Microsoft Print to PDF）。
 *
 * エディタDOMを直接印刷するのではなく、HTML出力と同一のパイプラインで
 * #print-root に文書を描画してから window.print() を呼ぶ。
 * これにより「HTML出力とPDFの見た目が一致する」ことを保証する。
 * 印刷スタイルは styles/print.css（A4余白・改ページ制御・UI非表示）。
 */

let printing = false;

const PAGE_RULE_ID = "print-page-rule";

/** 印刷の用紙サイズと向きを @page ルールとして注入する（縦/横の出し分け）。 */
function setPrintPageRule(orientation: "portrait" | "landscape"): void {
  let style = document.getElementById(PAGE_RULE_ID) as HTMLStyleElement | null;
  if (!style) {
    style = document.createElement("style");
    style.id = PAGE_RULE_ID;
    document.head.appendChild(style);
  }
  style.textContent = `@page { size: A4 ${orientation}; margin: 20mm 18mm; }`;
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
        ? await renderMermaidDocumentBody(extractMermaidSource(markdown), {
            onMermaidProgress,
          })
        : await renderDocumentBody(markdown, settings, { onMermaidProgress });

    // #print-root では相対パス画像を解決できないため data URI 化する
    await embedLocalImages(body, tab.filePath);

    ensureDocumentStyles();
    setHljsThemeStyle(settings.theme.highlightTheme);

    let root = document.getElementById("print-root");
    if (!root) {
      root = document.createElement("div");
      root.id = "print-root";
      document.body.appendChild(root);
    }
    root.replaceChildren();
    const main = document.createElement("main");
    main.className = ["document", ...docModifierClasses(settings)].join(" ");
    main.setAttribute("style", docThemeCssVars(settings.theme));
    main.innerHTML = body.innerHTML;
    root.appendChild(main);

    setPrintPageRule(orientation);
    progress.close();
    document.body.classList.add("printing-doc");
    // window.print() は印刷ダイアログが閉じるまでブロックする
    window.print();
  } catch (e) {
    console.error("printActiveTab failed:", e);
    progress.close();
    await message(
      `${t("print.failed")}\n${e instanceof Error ? e.message : String(e)}`,
      { kind: "error" },
    );
  } finally {
    document.body.classList.remove("printing-doc");
    document.getElementById("print-root")?.replaceChildren();
    printing = false;
  }
}
