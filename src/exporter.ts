import { invoke } from "@tauri-apps/api/core";
import { save as saveDialog, message } from "@tauri-apps/plugin-dialog";
import { store, type Tab } from "./store";
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
        ? await renderMermaidDocumentBody(extractMermaidSource(markdown), settings, {
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
 * 元タブ(markdown)からプレビュー用の文書HTMLをレンダリングして返す。
 * HTML出力と同一パイプラインを通すため「見たまま出力される」ことを保証する。
 */
async function renderExportPreview(
  filePath: string | null,
  markdown: string,
): Promise<{ html: string; title: string }> {
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
      fileTypeOfPath(filePath) === "mmd"
        ? await renderMermaidDocumentBody(extractMermaidSource(markdown), settings, {
            onMermaidProgress,
          })
        : await renderDocumentBody(markdown, settings, { onMermaidProgress });

    await embedLocalImages(body, filePath);

    // プレビュータブの .document にも文書CSS / ハイライトCSSを適用する
    ensureDocumentStyles();
    setHljsThemeStyle(settings.theme.highlightTheme);

    const main = document.createElement("main");
    main.className = ["document", ...docModifierClasses(settings)].join(" ");
    main.setAttribute("style", docThemeCssVars(settings.theme));
    main.innerHTML = body.innerHTML;

    const name = baseNameWithoutExt(filePath);
    return { html: main.outerHTML, title: `${t("preview.tabPrefix")}${name}` };
  } finally {
    progress.close();
  }
}

/**
 * アクティブタブの内容を、HTML出力と同じ見た目で読み取り専用の新規タブに表示する。
 * 保存はしない（出力前の見た目確認用）。元タブを記録し、更新で再レンダリングできる。
 */
export async function openHtmlPreviewTab(editor: EditorHost): Promise<void> {
  const tab = store.getActive();
  if (!tab) return;
  const markdown = editor.getMarkdown(tab.id);
  if (markdown === null) return; // プレビュータブ自身など、編集内容がない場合

  try {
    const { html, title } = await renderExportPreview(tab.filePath, markdown);
    store.addPreviewTab({
      title,
      html,
      mode: "export",
      sourceTabId: tab.id,
      sourceFilePath: tab.filePath,
    });
    const created = store.getActive();
    if (created) await editor.show(created);
  } catch (e) {
    console.error("openHtmlPreviewTab failed:", e);
    await message(
      `${t("export.failed")}\n${e instanceof Error ? e.message : String(e)}`,
      { kind: "error" },
    );
  }
}

/**
 * 外部HTMLファイルをサンドボックスiframeの読み取り専用タブで開く。
 */
export async function openHtmlFileTab(
  path: string,
  content: string,
  editor: EditorHost,
): Promise<void> {
  const name = baseNameWithoutExt(path);
  store.addPreviewTab({
    title: `${t("preview.tabPrefix")}${name}`,
    srcDoc: content,
    mode: "htmlfile",
    sourceFilePath: path,
  });
  const created = store.getActive();
  if (created) await editor.show(created);
}

/** プレビュータブを更新（再描画）できるか。 */
export function canRefreshPreview(tab: Tab, editor: EditorHost): boolean {
  if (tab.kind !== "preview") return false;
  if (tab.previewMode === "htmlfile") return !!tab.sourceFilePath;
  // export: 同一ウィンドウに元タブが残っている、またはディスクのファイルがある。
  const hasLiveSource =
    !!tab.sourceTabId && editor.getMarkdown(tab.sourceTabId) !== null;
  return hasLiveSource || !!tab.sourceFilePath;
}

/**
 * プレビュータブを元ソースから再レンダリングして内容を差し替える。
 * - htmlfile: sourceFilePath をディスクから読み直す。
 * - export: 同一ウィンドウの元タブの現在内容を優先、無ければ sourceFilePath を読む。
 * スクロール位置・ズーム倍率は editor.refreshPreviewPane が保持する。
 */
export async function refreshPreviewTab(
  previewTabId: string,
  editor: EditorHost,
): Promise<void> {
  const tab = store.getState().tabs.find((t) => t.id === previewTabId);
  if (!tab || tab.kind !== "preview") return;
  try {
    if (tab.previewMode === "htmlfile") {
      if (!tab.sourceFilePath) {
        await message(t("preview.cannotRefresh"), { kind: "info" });
        return;
      }
      const content = await invoke<string>("read_file", {
        path: tab.sourceFilePath,
      });
      store.updatePreview(previewTabId, { srcDoc: content });
      await editor.refreshPreviewPane(previewTabId);
      return;
    }
    // export モード
    let markdown: string | null = null;
    let filePath: string | null = tab.sourceFilePath ?? null;
    if (tab.sourceTabId) {
      const live = editor.getMarkdown(tab.sourceTabId);
      if (live !== null) {
        markdown = live;
        const src = store
          .getState()
          .tabs.find((t) => t.id === tab.sourceTabId);
        if (src) filePath = src.filePath;
      }
    }
    if (markdown === null && tab.sourceFilePath) {
      markdown = await invoke<string>("read_file", { path: tab.sourceFilePath });
      filePath = tab.sourceFilePath;
    }
    if (markdown === null) {
      await message(t("preview.cannotRefresh"), { kind: "info" });
      return;
    }
    const { html, title } = await renderExportPreview(filePath, markdown);
    store.updatePreview(previewTabId, { html, title });
    await editor.refreshPreviewPane(previewTabId);
  } catch (e) {
    console.error("refreshPreviewTab failed:", e);
    await message(
      `${t("export.failed")}\n${e instanceof Error ? e.message : String(e)}`,
      { kind: "error" },
    );
  }
}
