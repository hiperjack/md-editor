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
/**
 * タブの出力対象 markdown と filePath（既定パス・mmd判定用）を決める。
 * 通常タブはその内容を、export/slideshow プレビュータブは元ソース（同一ウィンドウの
 * 編集内容優先、無ければ元ファイルをディスクから読み直す）を返す。htmlfile プレビューや
 * 解決不可の場合は markdown = null。印刷（print.ts）・HTML出力・プレゼン出力で共用する。
 */
export async function resolveTabMarkdown(
  editor: EditorHost,
  tab: Tab,
): Promise<{ markdown: string | null; filePath: string | null }> {
  let filePath: string | null = tab.filePath;
  if (tab.kind !== "preview") {
    return { markdown: editor.getMarkdown(tab.id), filePath };
  }
  if (tab.previewMode !== "export" && tab.previewMode !== "slideshow")
    return { markdown: null, filePath };
  let markdown: string | null = null;
  if (tab.sourceTabId) {
    const live = editor.getMarkdown(tab.sourceTabId);
    if (live !== null) {
      markdown = live;
      const src = store.getState().tabs.find((t) => t.id === tab.sourceTabId);
      filePath = src ? src.filePath : tab.sourceFilePath ?? null;
    }
  }
  if (markdown === null && tab.sourceFilePath) {
    markdown = await invoke<string>("read_file", { path: tab.sourceFilePath });
    filePath = tab.sourceFilePath;
  }
  return { markdown, filePath };
}

export async function exportActiveTabAsHtml(editor: EditorHost): Promise<void> {
  if (!isTauriContext()) {
    console.warn("exportActiveTabAsHtml: Tauri context not available");
    return;
  }
  const tab = store.getActive();
  if (!tab) return;

  // 出力対象の markdown と filePath（既定パス・mmd判定に使う）を決める。
  // 通常の編集タブはその内容を、export/slideshow プレビュータブは元ソースを使う。
  const { markdown, filePath } = await resolveTabMarkdown(editor, tab);
  if (markdown === null) return;

  const picked = await saveDialog({
    title: t("export.dialogTitle"),
    filters: [{ name: "HTML", extensions: ["html"] }],
    defaultPath: defaultHtmlPath(filePath),
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
      fileTypeOfPath(filePath) === "mmd"
        ? await renderMermaidDocumentBody(extractMermaidSource(markdown), settings, {
            onMermaidProgress,
          })
        : await renderDocumentBody(markdown, settings, { onMermaidProgress });

    progress.update(t("export.rendering"));
    await embedLocalImages(body, filePath);

    const html = buildStandaloneHtml({
      title: baseNameWithoutExt(filePath),
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
 * プレゼンのPDF/HTML出力（presentation-export.ts）もこの結果を流用する。
 */
export async function renderExportPreview(
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
 * 同じ元タブ×同じモードの既存プレビュータブ。あればタブを増やさず再利用する。
 * 元タブが閉じられてディスク読みで開いた場合（sourceTabId=null）はパスで照合する。
 */
function findExistingPreview(
  sourceTabId: string | null,
  sourceFilePath: string | null,
  mode: "export" | "slideshow",
): Tab | undefined {
  return store.getState().tabs.find(
    (tb) =>
      tb.kind === "preview" &&
      tb.previewMode === mode &&
      (sourceTabId
        ? tb.sourceTabId === sourceTabId
        : !!sourceFilePath && tb.sourceFilePath === sourceFilePath),
  );
}

/**
 * プレビュー生成の元となるMarkdownを解決する。
 * - 通常タブ: そのタブの現在内容。
 * - プレビュータブ（export/slideshow）: 元タブの現在内容を優先し、元タブが
 *   閉じられていれば sourceFilePath をディスクから読む。これにより
 *   HTMLプレビュー上でプレゼン表示（またはその逆）を押しても元MDから開ける。
 * - 解決できない場合（外部HTMLプレビュー等）は null。
 */
async function resolvePreviewSource(
  tab: Tab,
  editor: EditorHost,
): Promise<{
  markdown: string;
  sourceTabId: string | null;
  filePath: string | null;
} | null> {
  const own = editor.getMarkdown(tab.id);
  if (own !== null) {
    return { markdown: own, sourceTabId: tab.id, filePath: tab.filePath };
  }
  if (tab.kind !== "preview" || tab.previewMode === "htmlfile") return null;
  if (tab.sourceTabId) {
    const live = editor.getMarkdown(tab.sourceTabId);
    if (live !== null) {
      const src = store.getState().tabs.find((t) => t.id === tab.sourceTabId);
      return {
        markdown: live,
        sourceTabId: tab.sourceTabId,
        filePath: src?.filePath ?? tab.sourceFilePath ?? null,
      };
    }
  }
  if (tab.sourceFilePath) {
    const markdown = await invoke<string>("read_file", {
      path: tab.sourceFilePath,
    });
    return { markdown, sourceTabId: null, filePath: tab.sourceFilePath };
  }
  return null;
}

/**
 * アクティブタブの内容を、HTML出力と同じ見た目で読み取り専用の新規タブに表示する。
 * 保存はしない（出力前の見た目確認用）。元タブを記録し、更新で再レンダリングできる。
 * 同じ元タブのプレビューが既にあれば、新規タブを増やさずそれを更新して切り替える。
 */
export async function openHtmlPreviewTab(editor: EditorHost): Promise<void> {
  const tab = store.getActive();
  if (!tab) return;

  try {
    const src = await resolvePreviewSource(tab, editor);
    if (!src) {
      // プレゼンタブ等で元タブが閉じられパスも無い場合は案内を出す
      // （外部HTMLプレビューは対象外なので黙って何もしない）。
      if (tab.kind === "preview" && tab.previewMode !== "htmlfile") {
        await message(t("preview.cannotRefresh"), { kind: "info" });
      }
      return;
    }
    const { html, title } = await renderExportPreview(
      src.filePath,
      src.markdown,
    );
    const existing = findExistingPreview(src.sourceTabId, src.filePath, "export");
    if (existing) {
      store.updatePreview(existing.id, { title, html });
      store.setActive(existing.id);
      await editor.show(existing);
      // show は既存ペインの再表示のみ。更新ボタンと同じ経路で内容を反映する。
      await editor.refreshPreviewPane(existing.id);
      return;
    }
    store.addPreviewTab({
      title,
      html,
      mode: "export",
      sourceTabId: src.sourceTabId,
      sourceFilePath: src.filePath,
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
 * アクティブタブの内容を、プレゼン（スライドショー）として読み取り専用の新規タブに表示する。
 * HTML出力と同一の文書HTMLをスライド単位に区切って見せる（mode="slideshow"）。
 * 文書プレビュー（openHtmlPreviewTab）と同じレンダリング結果を共有する。
 */
export async function openPresentationPreviewTab(
  editor: EditorHost,
): Promise<void> {
  const tab = store.getActive();
  if (!tab) return;

  try {
    const src = await resolvePreviewSource(tab, editor);
    if (!src) {
      if (tab.kind === "preview" && tab.previewMode !== "htmlfile") {
        await message(t("preview.cannotRefresh"), { kind: "info" });
      }
      return;
    }
    const { html, title } = await renderExportPreview(
      src.filePath,
      src.markdown,
    );
    const slideTitle = `${t("preview.slideTabPrefix")}${title.replace(t("preview.tabPrefix"), "")}`;
    const existing = findExistingPreview(
      src.sourceTabId,
      src.filePath,
      "slideshow",
    );
    if (existing) {
      store.updatePreview(existing.id, { title: slideTitle, html });
      store.setActive(existing.id);
      await editor.show(existing);
      // show は既存ペインの再表示のみ。更新ボタンと同じ経路で内容を反映する。
      await editor.refreshPreviewPane(existing.id);
      return;
    }
    store.addPreviewTab({
      title: slideTitle,
      html,
      mode: "slideshow",
      sourceTabId: src.sourceTabId,
      sourceFilePath: src.filePath,
    });
    const created = store.getActive();
    if (created) await editor.show(created);
  } catch (e) {
    console.error("openPresentationPreviewTab failed:", e);
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

  // 起動直後（アイコンへのD&D等）に残る空タブは、プレビューを開いたら片付ける。
  // openOrSwitch と同じ条件で「単一の空タブ」だけを対象にする。
  const { tabs } = store.getState();
  const startupEmptyId =
    tabs.length === 1 &&
    tabs[0].kind !== "preview" &&
    tabs[0].filePath === null &&
    tabs[0].diskContent === "" &&
    !store.isDirty(tabs[0].id)
      ? tabs[0].id
      : null;

  store.addPreviewTab({
    title: `${t("preview.tabPrefix")}${name}`,
    srcDoc: content,
    mode: "htmlfile",
    sourceFilePath: path,
  });
  const created = store.getActive();
  if (created) await editor.show(created);

  if (startupEmptyId) {
    await editor.destroy(startupEmptyId);
    store.removeTab(startupEmptyId);
  }
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
