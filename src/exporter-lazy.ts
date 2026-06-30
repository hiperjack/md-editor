// 起動バンドルから exporter.ts（および連鎖する render-pipeline / markdown-it）を
// 切り離すための遅延ロードシム。HTML出力・プレビュー生成は起動直後の編集には
// 不要なため、初回利用時にだけ動的importでロードする（Viteが別チャンクへ分割する）。
import type * as Exporter from "./exporter";
import type { EditorHost } from "./editor";
import type { Tab } from "./store";

let mod: typeof Exporter | null = null;
const load = async (): Promise<typeof Exporter> =>
  (mod ??= await import("./exporter"));

export async function exportActiveTabAsHtml(editor: EditorHost): Promise<void> {
  return (await load()).exportActiveTabAsHtml(editor);
}

export async function openHtmlPreviewTab(editor: EditorHost): Promise<void> {
  return (await load()).openHtmlPreviewTab(editor);
}

export async function openPresentationPreviewTab(
  editor: EditorHost,
): Promise<void> {
  return (await load()).openPresentationPreviewTab(editor);
}

export async function openHtmlFileTab(
  path: string,
  content: string,
  editor: EditorHost,
): Promise<void> {
  return (await load()).openHtmlFileTab(path, content, editor);
}

export async function refreshPreviewTab(
  previewTabId: string,
  editor: EditorHost,
): Promise<void> {
  return (await load()).refreshPreviewTab(previewTabId, editor);
}

// 同期述語。プレビュータブは上記のロード経路を通ってしか生成されないため、
// モジュール未ロード時は「対象タブなし＝更新不可」で false を返すのが正しい。
export function canRefreshPreview(tab: Tab, editor: EditorHost): boolean {
  return mod?.canRefreshPreview(tab, editor) ?? false;
}
