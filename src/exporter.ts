import { invoke } from "@tauri-apps/api/core";
import { save as saveDialog, message } from "@tauri-apps/plugin-dialog";
import { store } from "./store";
import type { EditorHost } from "./editor";
import {
  docTheme,
  docThemeCssVars,
  docModifierClasses,
  type DocSettings,
} from "./theme";
import {
  renderDocumentBody,
  renderMermaidDocumentBody,
  type MermaidProgress,
} from "./render-pipeline";
import { fileTypeOfPath, extractMermaidSource } from "./mmd";
import { embedLocalImages } from "./embed-images";
import { showProgress } from "./progress";
import {
  DOCUMENT_CSS,
  HLJS_THEME_CSS,
  ensureDocumentStyles,
  setHljsThemeStyle,
} from "./doc-styles";
import { settings as appSettings } from "./settings";
import { t } from "./i18n";

/**
 * F1: HTML出力（Ctrl+Shift+E）。
 *
 * 単体で配布できる自己完結型HTMLを書き出す。
 * - document.css / hljsテーマCSS / テーマCSS変数を<style>にインライン展開
 * - MermaidはSVGに変換済みで埋め込む（出力HTMLはJavaScript不要）
 * - ローカル画像はdata URIで埋め込む（外部ファイル参照を持たない）
 */

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

function defaultHtmlPath(filePath: string | null): string {
  if (!filePath) return "Untitled.html";
  const dot = filePath.lastIndexOf(".");
  const sep = Math.max(filePath.lastIndexOf("/"), filePath.lastIndexOf("\\"));
  return (dot > sep ? filePath.slice(0, dot) : filePath) + ".html";
}

/** 文書本文HTMLを自己完結型のHTML文書に組み立てる。 */
export function buildStandaloneHtml(opts: {
  title: string;
  settings: DocSettings;
  bodyHtml: string;
}): string {
  const { title, settings, bodyHtml } = opts;
  const lang = appSettings.getEffectiveLang();
  const classes = ["document", ...docModifierClasses(settings)].join(" ");
  return `<!DOCTYPE html>
<html lang="${lang}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${escapeHtml(title)}</title>
<style>
${DOCUMENT_CSS}
${HLJS_THEME_CSS[settings.theme.highlightTheme]}
.document {
${docThemeCssVars(settings.theme)}
}
</style>
</head>
<body style="margin:0;background:${settings.theme.bgColor};">
<main class="${classes}">
${bodyHtml}
</main>
</body>
</html>
`;
}

/**
 * アクティブタブの内容（保存前の編集中内容を含む）をHTMLとして出力する。
 * .mmd タブはSVG1枚を中央配置した単体HTMLになる。
 */
export async function exportActiveTabAsHtml(editor: EditorHost): Promise<void> {
  if (!isTauriContext()) {
    console.warn("exportActiveTabAsHtml: Tauri context not available");
    return;
  }
  const tab = store.getActive();
  if (!tab) return;
  const markdown = editor.getMarkdown(tab.id);
  if (markdown === null) return;

  const picked = await saveDialog({
    title: t("export.dialogTitle"),
    filters: [{ name: "HTML", extensions: ["html"] }],
    defaultPath: defaultHtmlPath(tab.filePath),
  });
  if (!picked) return;

  const settings = docTheme.get();
  const progress = showProgress(t("export.rendering"));
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

    progress.update(t("export.rendering"));
    await embedLocalImages(body, tab.filePath);

    const html = buildStandaloneHtml({
      title: baseNameWithoutExt(tab.filePath),
      settings,
      bodyHtml: body.innerHTML,
    });
    await invoke<void>("write_file", { path: picked, content: html });
  } catch (e) {
    console.error("exportActiveTabAsHtml failed:", e);
    await message(
      `${t("export.failed")}\n${e instanceof Error ? e.message : String(e)}`,
      { kind: "error" },
    );
  } finally {
    progress.close();
  }
}

/**
 * アクティブタブの内容を、HTML出力と同じ見た目で読み取り専用の新規タブに表示する。
 * 保存はしない（出力前の見た目確認用）。HTML出力と同一パイプラインを通すため、
 * 「プレビューで見た通りに出力される」ことが保証される。
 */
export async function openHtmlPreviewTab(editor: EditorHost): Promise<void> {
  const tab = store.getActive();
  if (!tab) return;
  const markdown = editor.getMarkdown(tab.id);
  if (markdown === null) return; // プレビュータブ自身など、編集内容がない場合

  const settings = docTheme.get();
  const progress = showProgress(t("export.rendering"));
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

    await embedLocalImages(body, tab.filePath);

    // プレビュータブの .document にも文書CSS / ハイライトCSSを適用する
    ensureDocumentStyles();
    setHljsThemeStyle(settings.theme.highlightTheme);

    const main = document.createElement("main");
    main.className = ["document", ...docModifierClasses(settings)].join(" ");
    main.setAttribute("style", docThemeCssVars(settings.theme));
    main.innerHTML = body.innerHTML;

    const name = baseNameWithoutExt(tab.filePath);
    store.addPreviewTab({
      title: `${t("preview.tabPrefix")}${name}`,
      html: main.outerHTML,
    });
    const created = store.getActive();
    if (created) await editor.show(created);
  } catch (e) {
    console.error("openHtmlPreviewTab failed:", e);
    await message(
      `${t("export.failed")}\n${e instanceof Error ? e.message : String(e)}`,
      { kind: "error" },
    );
  } finally {
    progress.close();
  }
}
