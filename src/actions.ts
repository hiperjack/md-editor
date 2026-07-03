import { invoke } from "@tauri-apps/api/core";
import { WebviewWindow } from "@tauri-apps/api/webviewWindow";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { save as saveDialog, open as openDialog } from "@tauri-apps/plugin-dialog";
import { store, type Tab } from "./store";
import { confirmSave, confirmDuplicate, confirmDuplicateWindow } from "./modal";
import type { EditorHost } from "./editor";
import { fileTypeOfPath, extractMermaidSource } from "./mmd";
import { openHtmlFileTab } from "./exporter-lazy";
import { showProgress } from "./progress";
import { t } from "./i18n";

const MD_FILTERS = [
  { name: "Markdown", extensions: ["md", "markdown"] },
  { name: "Mermaid", extensions: ["mmd", "mermaid"] },
  { name: "HTML", extensions: ["html", "htm"] },
  { name: "All Files", extensions: ["*"] },
];

/**
 * 保存先パスの種別に応じて、エディタのmarkdownをディスクへ書く内容に変換する。
 * .mmd はフェンスをアンラップして素のMermaidソースに戻す。
 */
function contentForDisk(markdown: string, path: string): string {
  return fileTypeOfPath(path) === "mmd"
    ? extractMermaidSource(markdown)
    : markdown;
}

function isTauriContext(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

function fileNameOf(tab: Tab): string {
  if (!tab.filePath) return "Untitled";
  const m = tab.filePath.split(/[\\/]/);
  return m[m.length - 1] || tab.filePath;
}

async function writeFile(path: string, content: string): Promise<void> {
  await invoke<void>("write_file", { path, content });
}

async function readFile(path: string): Promise<string> {
  return await invoke<string>("read_file", { path });
}

async function addRecent(path: string): Promise<void> {
  try {
    await invoke<void>("add_recent_file", { path });
  } catch (e) {
    console.warn("add_recent_file failed:", e);
  }
}

/**
 * md タブ限定で、貼り付け画像を img/<md名>/ へ書き出してから markdown を取り直す。
 * 失敗があればトーストで通知する（保存自体は続行）。
 * @returns 永続化後の最新 markdown（書換が無ければ元の値と同じ）。
 */
async function persistImagesThenGetMarkdown(
  tabId: string,
  path: string,
  editor: EditorHost,
  fallbackMarkdown: string,
): Promise<string> {
  if (fileTypeOfPath(path) !== "md") return fallbackMarkdown;
  try {
    const res = await editor.persistImages(tabId, path);
    if (res.failed > 0) {
      const toast = showProgress(
        t("save.imagesFailed").replace("{count}", String(res.failed)),
      );
      setTimeout(() => toast.close(), 4000);
    }
  } catch (e) {
    console.warn("persistImages failed:", e);
  }
  return editor.getMarkdown(tabId) ?? fallbackMarkdown;
}

export async function saveTab(
  tabId: string,
  editor: EditorHost,
): Promise<boolean> {
  if (!isTauriContext()) {
    console.warn("saveTab: Tauri context not available");
    return false;
  }
  const tab = store.getState().tabs.find((t) => t.id === tabId);
  if (!tab) return false;

  const markdown = editor.getMarkdown(tabId);
  if (markdown === null) return false;

  const prevType = fileTypeOfPath(tab.filePath);
  let path = tab.filePath;
  if (!path) {
    const picked = await saveDialog({
      title: "名前を付けて保存",
      filters: MD_FILTERS,
      defaultPath: "Untitled.md",
    });
    if (!picked) return false;
    path = picked;
  }

  const finalMarkdown = await persistImagesThenGetMarkdown(tabId, path, editor, markdown);
  const content = contentForDisk(finalMarkdown, path);
  await writeFile(path, content);
  store.markSaved(tabId, path, content);
  editor.resetBaseline(tabId);
  void addRecent(path);
  // md⇄mmd の種別が変わったらラップ規約が変わるため、保存内容でエディタを作り直す
  if (prevType !== fileTypeOfPath(path)) {
    const saved = store.getState().tabs.find((t) => t.id === tabId);
    if (saved) await editor.recreate(saved);
  }
  return true;
}

export async function saveTabAs(
  tabId: string,
  editor: EditorHost,
): Promise<boolean> {
  if (!isTauriContext()) return false;
  const tab = store.getState().tabs.find((t) => t.id === tabId);
  if (!tab) return false;

  const markdown = editor.getMarkdown(tabId);
  if (markdown === null) return false;

  const picked = await saveDialog({
    title: "名前を付けて保存",
    filters: MD_FILTERS,
    defaultPath: tab.filePath ?? "Untitled.md",
  });
  if (!picked) return false;

  const prevType = fileTypeOfPath(tab.filePath);
  const finalMarkdown = await persistImagesThenGetMarkdown(tabId, picked, editor, markdown);
  const content = contentForDisk(finalMarkdown, picked);
  await writeFile(picked, content);
  store.markSaved(tabId, picked, content);
  editor.resetBaseline(tabId);
  void addRecent(picked);
  // md⇄mmd の種別が変わったらラップ規約が変わるため、保存内容でエディタを作り直す
  if (prevType !== fileTypeOfPath(picked)) {
    const saved = store.getState().tabs.find((t) => t.id === tabId);
    if (saved) await editor.recreate(saved);
  }
  return true;
}

export async function openFileFromDialog(editor: EditorHost): Promise<void> {
  if (!isTauriContext()) return;
  const picked = await openDialog({
    title: "ファイルを開く",
    filters: MD_FILTERS,
    multiple: false,
    directory: false,
  });
  if (!picked || typeof picked !== "string") return;
  const content = await readFile(picked);
  if (/\.html?$/i.test(picked)) {
    await openHtmlFileTab(picked, content, editor);
  } else {
    await openOrSwitch(picked, content, editor);
  }
}

/**
 * ファイルパスと内容を受けて、既存タブがあれば切替/開き直し、なければ新規タブを作る。
 * 起動直後の空タブを置き換える特殊処理も含む。
 */
export async function openOrSwitch(
  path: string,
  content: string,
  editor: EditorHost,
): Promise<void> {
  void addRecent(path);
  const existing = store.findByPath(path);
  if (existing) {
    if (!store.isDirty(existing.id) && existing.diskContent === content) {
      // 編集なし & 外部変更なし → 単に切替
      store.setActive(existing.id);
      const a = store.getActive();
      if (a) await editor.show(a);
      return;
    }
    const choice = await confirmDuplicate(fileNameOf(existing));
    if (choice === "cancel") return;
    if (choice === "switch") {
      store.setActive(existing.id);
      const a = store.getActive();
      if (a) await editor.show(a);
      return;
    }
    // reload: ストアを更新してエディタを作り直す
    store.setDiskContent(existing.id, content);
    store.setActive(existing.id);
    const tab = store.getActive();
    if (tab) {
      await editor.recreate(tab);
    }
    return;
  }

  // 別ウィンドウで同じファイルを開いていないか確認する。
  if (isTauriContext()) {
    try {
      const otherWin = await invoke<string | null>("find_file_window", {
        path,
        sourceLabel: getCurrentWindow().label,
      });
      if (otherWin) {
        const name = path.split(/[\\/]/).pop() || path;
        const choice = await confirmDuplicateWindow(name);
        if (choice === "cancel") return;
        if (choice === "switch") {
          await invoke("activate_file_in_window", {
            targetLabel: otherWin,
            path,
          });
          return;
        }
        // "open" の場合はこのまま自ウィンドウで開く。
      }
    } catch (e) {
      console.warn("find_file_window failed:", e);
    }
  }

  // 起動直後の空タブを置き換え（プレビュータブは空タブ扱いにしない）
  const { tabs } = store.getState();
  if (
    tabs.length === 1 &&
    tabs[0].kind !== "preview" &&
    tabs[0].filePath === null &&
    tabs[0].diskContent === "" &&
    !store.isDirty(tabs[0].id)
  ) {
    const id = tabs[0].id;
    // 既存の空エディタは破棄して新内容で作り直す
    await editor.destroy(id);
    store.markSaved(id, path, content);
    const tab = store.getState().tabs.find((t) => t.id === id);
    if (tab) {
      await editor.show(tab);
    }
    return;
  }

  // 新規タブで開く
  store.addTab({ filePath: path, content });
  const a = store.getActive();
  if (a) await editor.show(a);
}

/**
 * タブを閉じる。dirtyなら保存確認。
 * @returns 実際に閉じたら true、保存ダイアログ等でキャンセルされたら false。
 */
export async function closeTab(
  tabId: string,
  editor: EditorHost,
): Promise<boolean> {
  const tab = store.getState().tabs.find((t) => t.id === tabId);
  if (!tab) return false;

  if (store.isDirty(tabId)) {
    const choice = await confirmSave(fileNameOf(tab));
    if (choice === "cancel") return false;
    if (choice === "save") {
      const ok = await saveTab(tabId, editor);
      if (!ok) return false;
    }
  }
  await editor.destroy(tabId);
  store.removeTab(tabId);
  // 残タブのアクティブをエディタに反映
  const a = store.getActive();
  if (a) await editor.show(a);
  return true;
}

/** 指定タブ以外をすべて閉じる。保存がキャンセルされたら以降を中断する。 */
export async function closeOtherTabs(
  tabId: string,
  editor: EditorHost,
): Promise<void> {
  const others = store
    .getState()
    .tabs.filter((t) => t.id !== tabId)
    .map((t) => t.id);
  for (const id of others) {
    const ok = await closeTab(id, editor);
    if (!ok) break;
  }
}

/** 指定タブより右側のタブをすべて閉じる。保存がキャンセルされたら以降を中断する。 */
export async function closeTabsToRight(
  tabId: string,
  editor: EditorHost,
): Promise<void> {
  const { tabs } = store.getState();
  const idx = tabs.findIndex((t) => t.id === tabId);
  if (idx < 0) return;
  const rightIds = tabs.slice(idx + 1).map((t) => t.id);
  for (const id of rightIds) {
    const ok = await closeTab(id, editor);
    if (!ok) break;
  }
}

/** タブのファイルパスをクリップボードにコピーする（パスが無ければ何もしない）。 */
export async function copyTabPath(tabId: string): Promise<void> {
  const tab = store.getState().tabs.find((t) => t.id === tabId);
  if (!tab?.filePath) return;
  try {
    await navigator.clipboard.writeText(tab.filePath);
  } catch (e) {
    console.warn("copyTabPath failed:", e);
  }
}

/** 新規ウィンドウ用の一意ラベルを生成する（capabilities の `tab-*` に一致させる）。 */
function genWindowLabel(): string {
  return `tab-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * タブを新規ウィンドウへ移送する。現在の表示内容（未保存分込み）と baseline を
 * 引き継ぎ、移送に成功したら元ウィンドウからタブを削除する。
 *
 * ウィンドウ生成はフロントの WebviewWindow API（Tauri 内部の正規経路）で行う。
 * Rust コマンド内での生成は Windows で白画面/フリーズする既知問題があるため使わない。
 * @param position 切り離しドラッグ時の画面座標（任意。新ウィンドウの初期位置）。
 */
export async function openTabInNewWindow(
  tabId: string,
  editor: EditorHost,
  position?: { x: number; y: number },
): Promise<void> {
  if (!isTauriContext()) return;
  const tab = store.getState().tabs.find((t) => t.id === tabId);
  if (!tab) return;

  const isPreview = tab.kind === "preview";
  const content = isPreview ? "" : (editor.getMarkdown(tabId) ?? tab.diskContent);
  const baseline = isPreview ? "" : (editor.getBaseline(tabId) ?? content);
  const label = genWindowLabel();

  // 先に内容を退避（新ウィンドウが起動時に take_pending_tab で取り出す）。
  try {
    await invoke<void>("stash_pending_tab", {
      label,
      payload: {
        filePath: tab.filePath,
        content,
        baseline,
        diskContent: tab.diskContent,
        ...(isPreview
          ? {
              kind: "preview",
              previewHtml: tab.previewHtml ?? "",
              previewTitle: tab.previewTitle ?? "",
              previewMode: tab.previewMode ?? "export",
              previewSrcDoc: tab.previewSrcDoc ?? "",
              sourceFilePath: tab.sourceFilePath ?? null,
            }
          : {}),
      },
    });
  } catch (e) {
    console.error("stash_pending_tab failed:", e);
    return;
  }

  const w = new WebviewWindow(label, {
    url: "index.html",
    title: "mdedit",
    width: 1100,
    height: 720,
    minWidth: 600,
    minHeight: 400,
    ...(position ? { x: position.x, y: position.y } : {}),
  });

  const created = await new Promise<boolean>((resolve) => {
    let settled = false;
    const done = (ok: boolean) => {
      if (settled) return;
      settled = true;
      resolve(ok);
    };
    void w.once("tauri://created", () => done(true));
    void w.once("tauri://error", (e) => {
      console.error("create window error:", e);
      done(false);
    });
    // 念のためのタイムアウト（イベントが来ない場合のフォールバック）。
    setTimeout(() => done(true), 2000);
  });

  if (!created) {
    // 生成失敗 → 退避を破棄して元タブは残す。
    try {
      await invoke("take_pending_tab", { label });
    } catch {
      /* 破棄失敗は無視 */
    }
    return;
  }

  await editor.destroy(tabId);
  store.removeTab(tabId);
  const a = store.getActive();
  if (a) await editor.show(a);
}

/**
 * タブを既存の別ウィンドウへ移送（結合）する。移送に成功したら元から削除する。
 */
export async function transferTabToWindow(
  tabId: string,
  targetLabel: string,
  editor: EditorHost,
): Promise<void> {
  if (!isTauriContext()) return;
  const tab = store.getState().tabs.find((t) => t.id === tabId);
  if (!tab) return;

  const isPreview = tab.kind === "preview";
  const content = isPreview ? "" : (editor.getMarkdown(tabId) ?? tab.diskContent);
  const baseline = isPreview ? "" : (editor.getBaseline(tabId) ?? content);

  // このタブが元ウィンドウの唯一のタブなら、移送後にウィンドウごと閉じる。
  const wasOnlyTab = store.getState().tabs.length === 1;

  try {
    await invoke<void>("transfer_tab", {
      targetLabel,
      payload: {
        filePath: tab.filePath,
        content,
        baseline,
        diskContent: tab.diskContent,
        ...(isPreview
          ? {
              kind: "preview",
              previewHtml: tab.previewHtml ?? "",
              previewTitle: tab.previewTitle ?? "",
              previewMode: tab.previewMode ?? "export",
              previewSrcDoc: tab.previewSrcDoc ?? "",
              sourceFilePath: tab.sourceFilePath ?? null,
            }
          : {}),
      },
    });
  } catch (e) {
    console.error("transfer_tab failed:", e);
    return;
  }

  // 先にタブを除去してから、孤立したウィンドウを閉じる。
  await editor.destroy(tabId);
  store.removeTab(tabId);

  if (wasOnlyTab) {
    try {
      // removeTab は最後の1枚を消すと空タブを自動再生成するため、close()
      // （onCloseRequested 経由）では確実に閉じない。destroy() で強制的に閉じる。
      // 移送済みなので内容は失われない。
      await getCurrentWindow().destroy();
      return;
    } catch (e) {
      console.warn("destroy source window failed:", e);
    }
  }

  const a = store.getActive();
  if (a) await editor.show(a);
}

/** 移送ペイロード（Rust の TabPayload と対応）。 */
export type MovedTabPayload = {
  filePath: string | null;
  content: string;
  baseline: string;
  diskContent: string;
  /** "preview" のとき移送先はプレビュータブとして復元する。通常タブでは undefined。 */
  kind?: "preview";
  previewHtml?: string;
  previewTitle?: string;
  previewMode?: "export" | "slideshow" | "htmlfile";
  previewSrcDoc?: string;
  sourceFilePath?: string | null;
  /** 発表専用ウィンドウ: 起動後このスライド番号から自動で発表を開始する。 */
  presentAt?: number | null;
  /** 発表専用ウィンドウ: 発表元ウィンドウのラベル（終了時のスライド番号同期先）。 */
  openerLabel?: string | null;
  /** 発表専用ウィンドウ: 発表元のプレゼンタブID（スライド番号同期用）。 */
  sourceTabId?: string | null;
};

/**
 * 発表専用ウィンドウ（PowerPoint方式）を開く。
 *
 * メインウィンドウをフルスクリーン化するとOSのスナップ状態が壊れるため、
 * 発表はフルスクリーンの別ウィンドウで行い、メインウィンドウには一切触れない。
 * 内容はタブ移送と同じ stash_pending_tab / take_pending_tab で受け渡す。
 * 生成に失敗した場合は false（呼び出し側が従来のオーバーレイ発表へフォールバック）。
 */
export async function openPresentationWindow(opts: {
  html: string;
  title: string;
  sourceFilePath: string | null;
  sourceTabId: string;
  presentAt: number;
}): Promise<boolean> {
  if (!isTauriContext()) return false;
  const label = genWindowLabel();
  try {
    await invoke<void>("stash_pending_tab", {
      label,
      payload: {
        filePath: null,
        content: "",
        baseline: "",
        diskContent: "",
        kind: "preview",
        previewHtml: opts.html,
        previewTitle: opts.title,
        previewMode: "slideshow",
        previewSrcDoc: "",
        sourceFilePath: opts.sourceFilePath,
        presentAt: opts.presentAt,
        openerLabel: getCurrentWindow().label,
        sourceTabId: opts.sourceTabId,
      },
    });
  } catch (e) {
    console.error("stash_pending_tab (presentation) failed:", e);
    return false;
  }

  // 非表示で生成し、発表オーバーレイの準備完了後に presentation.ts 側が
  // show() する（起動中のエディタUIが全画面で見えるのを防ぐ）。
  const w = new WebviewWindow(label, {
    url: "index.html",
    title: opts.title,
    fullscreen: true,
    visible: false,
  });
  const created = await new Promise<boolean>((resolve) => {
    let settled = false;
    const done = (ok: boolean) => {
      if (settled) return;
      settled = true;
      resolve(ok);
    };
    void w.once("tauri://created", () => done(true));
    void w.once("tauri://error", (e) => {
      console.error("create presentation window error:", e);
      done(false);
    });
    setTimeout(() => done(true), 2000);
  });
  if (!created) {
    try {
      await invoke("take_pending_tab", { label });
    } catch {
      /* 破棄失敗は無視 */
    }
    return false;
  }
  return true;
}

/**
 * 新規ウィンドウ起動時、移送されてきたタブを開く。
 * 起動直後の空タブがあれば置き換える。
 */
export async function openMovedTab(
  payload: MovedTabPayload,
  editor: EditorHost,
): Promise<void> {
  const { tabs } = store.getState();
  const blankId =
    tabs.length === 1 &&
    tabs[0].kind !== "preview" &&
    tabs[0].filePath === null &&
    tabs[0].diskContent === "" &&
    !store.isDirty(tabs[0].id)
      ? tabs[0].id
      : null;

  if (payload.kind === "preview") {
    // 発表専用ウィンドウ: マウント完了時に自動で発表を開始するよう予約し、
    // 発表オーバーレイが出るまで通常UIを隠す（黒背景のまま起動して見せる）。
    if (payload.presentAt != null) {
      document.body.classList.add("pres-window-boot");
      const { armPresentationWindow } = await import("./presentation-lazy");
      await armPresentationWindow({
        index: payload.presentAt,
        openerLabel: payload.openerLabel ?? null,
        sourceTabId: payload.sourceTabId ?? null,
      });
    }
    // プレビュータブとして復元する（ズーム倍率は引き継がず等倍）。
    store.addPreviewTab({
      title: payload.previewTitle ?? "Preview",
      html: payload.previewHtml,
      srcDoc: payload.previewSrcDoc,
      mode: payload.previewMode ?? "export",
      sourceFilePath: payload.sourceFilePath ?? null,
    });
  } else {
    store.addTab({
      filePath: payload.filePath,
      content: payload.diskContent,
      initialContent: payload.content,
      initialBaseline: payload.baseline,
    });
  }
  const moved = store.getActive();
  if (moved) await editor.show(moved);

  if (blankId) {
    await editor.destroy(blankId);
    store.removeTab(blankId);
  }
}

export async function newTab(editor: EditorHost): Promise<void> {
  store.addTab();
  const a = store.getActive();
  if (a) await editor.show(a);
}

/**
 * このウィンドウが開いているファイルパス一覧を Rust の全体レジストリへ同期する。
 * ウィンドウ間の同一ファイル二重オープン検知に使う。変化が無ければ送らない。
 */
let lastOpenFilesKey = "";
export async function syncOpenFiles(): Promise<void> {
  if (!isTauriContext()) return;
  const paths = store
    .getState()
    .tabs.map((t) => t.filePath)
    .filter((p): p is string => !!p);
  const key = paths.join("\n");
  if (key === lastOpenFilesKey) return;
  lastOpenFilesKey = key;
  try {
    await invoke("set_open_files", {
      label: getCurrentWindow().label,
      paths,
    });
  } catch (e) {
    console.warn("set_open_files failed:", e);
  }
}
