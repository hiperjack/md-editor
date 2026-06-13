export type Tab = {
  id: string;
  filePath: string | null;
  /** ディスク上の生のmarkdown。findByPath時の外部変更検知に使う。 */
  diskContent: string;
  /** 編集が発生したか。エディタ層がmarkdownUpdatedで更新する。 */
  dirty: boolean;
  /** タブ種別。省略時は通常のエディタタブ。 */
  kind?: "editor" | "preview";
  /** preview タブ: 表示する文書HTML（<main class="document">…</main> 込み）。 */
  previewHtml?: string;
  /** preview タブ: タブに表示する名前。 */
  previewTitle?: string;
  /** preview タブの種別。"export"=markdown出力プレビュー（既定）、"htmlfile"=外部HTMLをiframe表示。 */
  previewMode?: "export" | "htmlfile";
  /** previewMode "htmlfile" のときの iframe srcdoc 用の生HTML。 */
  previewSrcDoc?: string;
  /** 更新（再レンダリング）用: 元エディタタブのid（同一ウィンドウ内）。 */
  sourceTabId?: string | null;
  /** 更新用: 元ファイルのパス（ディスク再読み込み用）。 */
  sourceFilePath?: string | null;
};

export type AppState = {
  tabs: Tab[];
  activeTabId: string | null;
};

type Listener = (state: AppState) => void;

function genId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return Math.random().toString(36).slice(2) + Date.now().toString(36);
}

const state: AppState = {
  tabs: [],
  activeTabId: null,
};

const listeners = new Set<Listener>();

/**
 * 移送（新規ウィンドウ化）で作るタブの初期内容オーバーライド。
 * エディタ生成時に一度だけ消費する（diskContent ではなく content を表示し、
 * baseline を移送元から引き継いで dirty 状態を保持するため）。
 */
type InitialOverride = { content: string; baseline: string };
const initialOverrides = new Map<string, InitialOverride>();

function notify(): void {
  for (const fn of listeners) fn(state);
}

function findIndex(tabId: string): number {
  return state.tabs.findIndex((t) => t.id === tabId);
}

export const store = {
  getState(): AppState {
    return state;
  },

  getActive(): Tab | null {
    if (!state.activeTabId) return null;
    return state.tabs.find((t) => t.id === state.activeTabId) ?? null;
  },

  isDirty(tabId: string): boolean {
    const tab = state.tabs.find((t) => t.id === tabId);
    return !!tab?.dirty;
  },

  hasAnyDirty(): boolean {
    return state.tabs.some((t) => t.dirty);
  },

  findByPath(path: string): Tab | null {
    return state.tabs.find((t) => t.filePath === path) ?? null;
  },

  addTab(opts?: {
    filePath?: string | null;
    content?: string;
    /** 移送タブ用: エディタに表示する内容（未保存分込み）。diskContent と別。 */
    initialContent?: string;
    /** 移送タブ用: dirty 判定の基準（移送元の baseline）。 */
    initialBaseline?: string;
  }): string {
    const filePath = opts?.filePath ?? null;
    const diskContent = opts?.content ?? "";
    const tab: Tab = {
      id: genId(),
      filePath,
      diskContent,
      dirty: false,
    };
    state.tabs.push(tab);
    state.activeTabId = tab.id;
    if (opts?.initialContent !== undefined) {
      initialOverrides.set(tab.id, {
        content: opts.initialContent,
        baseline: opts.initialBaseline ?? opts.initialContent,
      });
    }
    notify();
    return tab.id;
  },

  /** HTML見た目を表示する読み取り専用プレビュータブを追加する。 */
  addPreviewTab(opts: {
    title: string;
    html?: string;
    srcDoc?: string;
    mode?: "export" | "htmlfile";
    sourceTabId?: string | null;
    sourceFilePath?: string | null;
  }): string {
    const tab: Tab = {
      id: genId(),
      filePath: null,
      diskContent: "",
      dirty: false,
      kind: "preview",
      previewHtml: opts.html,
      previewTitle: opts.title,
      previewMode: opts.mode ?? "export",
      previewSrcDoc: opts.srcDoc,
      sourceTabId: opts.sourceTabId ?? null,
      sourceFilePath: opts.sourceFilePath ?? null,
    };
    state.tabs.push(tab);
    state.activeTabId = tab.id;
    notify();
    return tab.id;
  },

  /** 既存プレビュータブの内容を更新する（更新ボタン用）。指定フィールドのみ差し替え。 */
  updatePreview(
    tabId: string,
    patch: { title?: string; html?: string; srcDoc?: string },
  ): void {
    const tab = state.tabs.find((t) => t.id === tabId);
    if (!tab || tab.kind !== "preview") return;
    if (patch.title !== undefined) tab.previewTitle = patch.title;
    if (patch.html !== undefined) tab.previewHtml = patch.html;
    if (patch.srcDoc !== undefined) tab.previewSrcDoc = patch.srcDoc;
    notify();
  },

  /**
   * 既存タブのエディタ再生成（recreate）用に初期内容オーバーライドをセットする。
   * Mermaid配色変更時など、未保存内容・baselineを保ったまま作り直すのに使う。
   */
  setInitialOverride(
    tabId: string,
    ov: { content: string; baseline: string },
  ): void {
    initialOverrides.set(tabId, { content: ov.content, baseline: ov.baseline });
  },

  /** 移送タブの初期内容オーバーライドを取り出す（消費して削除）。 */
  takeInitialOverride(tabId: string): InitialOverride | undefined {
    const ov = initialOverrides.get(tabId);
    if (ov) initialOverrides.delete(tabId);
    return ov;
  },

  removeTab(tabId: string): void {
    const idx = findIndex(tabId);
    if (idx < 0) return;
    const wasActive = state.activeTabId === tabId;
    state.tabs.splice(idx, 1);

    if (state.tabs.length === 0) {
      const empty: Tab = {
        id: genId(),
        filePath: null,
        diskContent: "",
        dirty: false,
      };
      state.tabs.push(empty);
      state.activeTabId = empty.id;
    } else if (wasActive) {
      const nextIdx = idx < state.tabs.length ? idx : idx - 1;
      state.activeTabId = state.tabs[nextIdx].id;
    }
    notify();
  },

  setActive(tabId: string): void {
    if (state.activeTabId === tabId) return;
    if (findIndex(tabId) < 0) return;
    state.activeTabId = tabId;
    notify();
  },

  reorder(fromIndex: number, toIndex: number): void {
    if (fromIndex === toIndex) return;
    if (fromIndex < 0 || fromIndex >= state.tabs.length) return;
    if (toIndex < 0 || toIndex >= state.tabs.length) return;
    const [moved] = state.tabs.splice(fromIndex, 1);
    state.tabs.splice(toIndex, 0, moved);
    notify();
  },

  setDirty(tabId: string, dirty: boolean): void {
    const tab = state.tabs.find((t) => t.id === tabId);
    if (!tab) return;
    if (tab.dirty === dirty) return;
    tab.dirty = dirty;
    notify();
  },

  /** 保存成功後に呼ぶ。 */
  markSaved(tabId: string, savedPath: string, savedContent: string): void {
    const tab = state.tabs.find((t) => t.id === tabId);
    if (!tab) return;
    tab.filePath = savedPath;
    tab.diskContent = savedContent;
    tab.dirty = false;
    notify();
  },

  /** 外部からファイル内容を再ロード（重複オープンのreload用）。 */
  setDiskContent(tabId: string, diskContent: string): void {
    const tab = state.tabs.find((t) => t.id === tabId);
    if (!tab) return;
    tab.diskContent = diskContent;
    tab.dirty = false;
    notify();
  },

  subscribe(fn: Listener): () => void {
    listeners.add(fn);
    return () => listeners.delete(fn);
  },
};
