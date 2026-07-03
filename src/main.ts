import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { message } from "@tauri-apps/plugin-dialog";
import { store } from "./store";
import { createEditorHost } from "./editor";
import { createTabBar } from "./tabs";
import { createToolbar, makeToolbarActions } from "./toolbar";
import { setupTitle } from "./title";
import { openAboutModal } from "./about-modal";
import { createMenuBar, type TopMenu, type MenuEntry } from "./menu-bar";
import { makeEditOps } from "./edit-ops";
import { expandAllHeadingFolds } from "./heading-fold";
import { expandAllListFolds } from "./list-fold";
import { setupShortcuts } from "./shortcuts";
import { createFindReplace } from "./find-replace";
import { createOutlinePanel } from "./outline";
import { createEditorContextMenu } from "./editor-context-menu";
import {
  closeTab,
  closeOtherTabs,
  closeTabsToRight,
  copyTabPath,
  newTab,
  openOrSwitch,
  openFileFromDialog,
  openTabInNewWindow,
  openMovedTab,
  transferTabToWindow,
  syncOpenFiles,
  saveTab,
  saveTabAs,
  type MovedTabPayload,
} from "./actions";
import { confirmCloseAll } from "./modal";
import { settings } from "./settings";
import { docTheme, resolveMermaidScheme } from "./theme";
// exporter / presentation は起動に不要なため遅延ロードシム経由で参照する。
import { exportActiveTabAsHtml, openHtmlPreviewTab, openPresentationPreviewTab, openHtmlFileTab, refreshPreviewTab, canRefreshPreview as canRefreshPreviewTab } from "./exporter-lazy";
import { startPresentation, togglePresentationView, togglePresentationLaser, selectPresentationSlide, isPresentationGridView, isPresentationFullscreen, setPresentationChromeSync, getPresentationToolbar } from "./presentation-lazy";
import { expandAllPreviewFolds } from "./preview-fold";
import { showContextMenu, type MenuItem } from "./context-menu";
import { installDiagramViewerTrigger } from "./diagram-viewer";
import { setMermaidColorScheme } from "./mermaid-renderer";
import { setLang, t, onLangChange } from "./i18n";
import "./style.css";
import "./styles/print.css";

function isTauriContext(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

type OpenFilePayload = {
  path: string;
  content: string;
};

async function bootstrap(): Promise<void> {
  // 起動計測。localStorage.mdeditPerf="1" のときだけ各区間の経過を console に出す。
  // bootstrap 到達時点の performance.now() は「HTMLロード＋バンドル取得/解析/評価」の
  // おおよその合計を表す（navigation 起点）。以降は各処理の所要を区間で見る。
  // 起動計測。localStorage.mdeditPerf="1" のときだけ各区間の経過を console に出す。
  // 各行は「累積ms（navigation起点）」と直前区間の「+ms」。bootstrap 到達時点の値は
  // HTMLロード＋バンドル取得/解析/評価のおおよその合計を表す。
  const perfOn =
    typeof localStorage !== "undefined" &&
    localStorage.getItem("mdeditPerf") === "1";
  let lastMarkMs = 0;
  const mark = (label: string): void => {
    if (!perfOn) return;
    const now = performance.now();
    const delta = lastMarkMs ? now - lastMarkMs : now;
    lastMarkMs = now;
    console.info(
      `[startup] ${label}: ${now.toFixed(1)}ms (+${delta.toFixed(1)})`,
    );
  };
  mark("bootstrap-entry (bundle load+eval)");

  const menubarEl = document.getElementById("menubar");
  const tabbarEl = document.getElementById("tabbar");
  const toolbarEl = document.getElementById("toolbar");
  const editorHostEl = document.getElementById("editor-host");
  if (!menubarEl || !tabbarEl || !toolbarEl || !editorHostEl) {
    throw new Error("Required DOM elements not found");
  }

  // フォント・サイズ設定をDOMに反映
  settings.init();
  // i18nの初期言語を設定値（解決後の ja/en）に同期
  setLang(settings.getEffectiveLang());
  settings.subscribe(() => setLang(settings.getEffectiveLang()));
  // 文書テーマ（HTML出力・印刷用）をディスクから読み込む
  await docTheme.init();

  // Mermaid配色を解決する。既定（mermaidFollowApp=true）はアプリの表示テーマに揃え、
  // 個別指定のときだけ mermaidTheme を使う。
  const resolveActiveMermaidScheme = (): "light" | "dark" => {
    const dt = docTheme.get().theme;
    return dt.mermaidFollowApp
      ? settings.getEffectiveTheme()
      : resolveMermaidScheme(dt.mermaidTheme);
  };

  // 初期Mermaid配色を適用する。この時点ではエディタ未生成のため、台紙CSS属性と
  // レンダラの配色設定のみ行う（変更購読＝作り直しはエディタ生成後に登録する）。
  {
    const initScheme = resolveActiveMermaidScheme();
    document.documentElement.setAttribute("data-mermaid-scheme", initScheme);
    setMermaidColorScheme(initScheme);
  }

  // 外部URL (http/https) のアンカークリックを既定ブラウザで開く。
  // 対象:
  //   - Milkdown link preview ポップアップ内の URL (target="_blank" のアンカー)
  //   - エディタ本文のリンクマーク <a> は Ctrl/Meta+クリック時のみ開く
  //     (素クリックはカーソル移動の標準挙動を温存)
  // Tauri の WebView2 は target="_blank" を OS 既定ブラウザに転送しないので、
  // ここで捕捉して open_external_url コマンド経由で開く。
  const openExternal = (url: string) => {
    if (isTauriContext()) {
      void invoke("open_external_url", { url }).catch((err) =>
        console.warn("open_external_url failed:", err),
      );
    } else {
      window.open(url, "_blank", "noopener,noreferrer");
    }
  };
  document.addEventListener(
    "click",
    (e) => {
      const target = e.target as Element | null;
      if (!target) return;
      const anchor = target.closest("a") as HTMLAnchorElement | null;
      if (!anchor) return;
      const href = anchor.getAttribute("href") ?? "";
      if (!/^https?:\/\//i.test(href)) return;
      const inPreview =
        anchor.closest(".milkdown-link-preview, .link-preview") !== null;
      const modified = e.ctrlKey || e.metaKey;
      if (!inPreview && !modified) return;
      e.preventDefault();
      e.stopPropagation();
      openExternal(href);
    },
    { capture: true },
  );

  // プレビュータブ専用ズーム（エディタのグローバル文字サイズとは独立）。
  // CSS の zoom を .document に適用し、倍率は pane の dataset に保持する。
  const PREVIEW_ZOOM_MIN = 0.5;
  const PREVIEW_ZOOM_MAX = 3.0;
  const adjustPreviewZoom = (pane: HTMLElement, delta: number): void => {
    const doc = pane.querySelector<HTMLElement>(".document");
    if (!doc) return;
    const current = parseFloat(pane.dataset.zoom ?? "1") || 1;
    const factor = delta > 0 ? 1.1 : 1 / 1.1;
    const next = Math.min(
      PREVIEW_ZOOM_MAX,
      Math.max(PREVIEW_ZOOM_MIN, current * factor),
    );
    pane.dataset.zoom = String(next);
    // zoom は非標準プロパティのため setProperty で設定する。
    doc.style.setProperty("zoom", String(next));
  };

  // Ctrl+ホイール で文字サイズ変更（WebView2の標準ズームを抑止するためcapture+非passive）
  document.addEventListener(
    "wheel",
    (e) => {
      if (!e.ctrlKey) return;
      // 図ビューア内のホイールはビューア側のズームに委ねる
      if ((e.target as Element | null)?.closest?.(".diagram-viewer-overlay")) {
        return;
      }
      // プレゼンプレビューは自前で Ctrl+ホイール（グリッドのタイル拡縮）を処理する。
      if ((e.target as Element | null)?.closest?.(".presentation")) {
        return;
      }
      e.preventDefault();
      e.stopPropagation();
      const delta = e.deltaY > 0 ? -1 : 1;
      // プレビュータブ上では、そのプレビューだけを独立してズームする。
      const pane = (e.target as Element | null)?.closest?.(
        ".preview-pane",
      ) as HTMLElement | null;
      if (pane) {
        adjustPreviewZoom(pane, delta);
        return;
      }
      settings.changeFontSize(delta);
    },
    { passive: false, capture: true },
  );

  // Mermaidプレビューのクリックで拡大・パン可能なビューアを開く
  installDiagramViewerTrigger();

  // WebView2 標準のキー動作を抑止する。
  // アプリ未提供／実害のあるブラウザ既定動作（再読み込み・印刷・ズーム）を潰す。
  document.addEventListener(
    "keydown",
    (e) => {
      const mod = e.ctrlKey || e.metaKey;
      const key = e.key.toLowerCase();

      // 再読み込み（Ctrl+R / Ctrl+Shift+R / F5 / Shift+F5）。
      // リロードするとタブ状態がメモリごとリセットされ、未保存内容が
      // 無警告で失われる（onCloseRequested も発火しない）ため抑止する。
      // ただしプレビュータブ上の F5 は用途別に割り当てる:
      //  - プレゼンタブ: F5=先頭から発表 / Shift+F5=表示中ページから発表
      //  - その他プレビュー: 単独 F5=プレビュー更新
      if (key === "f5" || (mod && key === "r")) {
        e.preventDefault();
        if (key === "f5" && !mod) {
          const active = store.getActive();
          if (active?.kind === "preview" && active.previewMode === "slideshow") {
            startPresentation(active.id, !e.shiftKey);
          } else if (
            active &&
            !e.shiftKey &&
            active.kind === "preview" &&
            canRefreshPreviewTab(active, editor)
          ) {
            void refreshPreviewTab(active.id, editor);
          }
        }
        return;
      }

      // F12: DevTools の代わりに「名前を付けて保存」に割り当てる。
      if (key === "f12") {
        e.preventDefault();
        fileActions.file_save_as?.();
        return;
      }

      if (!mod) return;

      // ブラウザ標準ズーム（メニュー accelerator 側で処理するため既定だけ抑止）
      if (e.key === "+" || e.key === "=" || e.key === "-" || e.key === "0") {
        e.preventDefault();
        return;
      }

      // DevTools を開くブラウザ標準キー（Ctrl+Shift+J / Ctrl+Shift+C）を抑止。
      // ※ Ctrl+Shift+I はソース表示トグルに再割り当て（shortcuts.ts で処理）。
      if (e.shiftKey && (key === "j" || key === "c")) {
        e.preventDefault();
        return;
      }

      // Ctrl+J: ブラウザ標準のダウンロード表示を抑止（アプリでは未使用）。
      if (key === "j") {
        e.preventDefault();
        return;
      }

      // 注: Ctrl+P（印刷）は shortcuts.ts で一本化して処理する。
      // ここでも拾うと file_print が二重に呼ばれ、印刷が二重起動するため拾わない。
      // Ctrl+Shift+P（標準のシステム印刷）の抑止も shortcuts.ts 側で行う。
    },
    { capture: true },
  );

  mark("pre-editor (settings/docTheme done)");
  const editor = createEditorHost(editorHostEl);
  const find = createFindReplace(editor);
  const outline = createOutlinePanel(editor);
  mark("editor-host created");

  // Mermaid配色の変更を購読する。配色が変わったら、図を含むタブを作り直して
  // 確実に反映する。Crepe(Vue)管理下のプレビューDOMを直接書き換えると、Vueの
  // 再描画で旧配色に戻されるため、開き直しと同等の「作り直し」経路を使う。
  const applyMermaidScheme = () => {
    const scheme = resolveActiveMermaidScheme();
    document.documentElement.setAttribute("data-mermaid-scheme", scheme);
    const changed = setMermaidColorScheme(scheme);
    if (changed) void editor.recreateMermaidTabs();
  };
  docTheme.subscribe(applyMermaidScheme);
  // アプリ表示テーマに揃える設定では、表示テーマ（settings.theme）変更にも追従する。
  settings.subscribe(applyMermaidScheme);
  // OSのライト/ダーク変更に追従する（アプリ追従 or Mermaid個別が "system" のとき）。
  if (typeof window.matchMedia === "function") {
    window
      .matchMedia("(prefers-color-scheme: dark)")
      .addEventListener("change", () => applyMermaidScheme());
  }

  store.addTab();
  const initial = store.getActive();
  if (initial) await editor.show(initial);
  mark("first editor.show done");

  let prevActiveId: string | null = store.getState().activeTabId;
  store.subscribe(() => {
    const cur = store.getState().activeTabId;
    if (cur !== prevActiveId) {
      prevActiveId = cur;
      const t = store.getActive();
      if (t) {
        void editor.show(t).then(() => {
          find.refresh();
          outline.refresh();
        });
      }
    }
  });

  // 結合ドラッグ中、ポインタ位置を Rust に通知して結合先ウィンドウに青線を出させる。
  // rAF でスロットルし、毎フレーム1回だけ送る。
  let dragOverRaf = 0;
  let pendingDragPos: { x: number; y: number } | null = null;
  const onTabDragMove = (sx: number, sy: number) => {
    if (!isTauriContext()) return;
    pendingDragPos = { x: sx, y: sy };
    if (dragOverRaf) return;
    dragOverRaf = requestAnimationFrame(() => {
      dragOverRaf = 0;
      const p = pendingDragPos;
      pendingDragPos = null;
      if (!p) return;
      void invoke("drag_over", {
        sourceLabel: getCurrentWindow().label,
        x: p.x,
        y: p.y,
      }).catch(() => {});
    });
  };
  const onTabDragEnd = () => {
    if (dragOverRaf) {
      cancelAnimationFrame(dragOverRaf);
      dragOverRaf = 0;
    }
    pendingDragPos = null;
    if (!isTauriContext()) return;
    void invoke("drag_end").catch(() => {});
  };

  const tabbar = createTabBar(tabbarEl, {
    onSelect: (id) => store.setActive(id),
    onClose: (id) => {
      void closeTab(id, editor);
    },
    onNew: () => {
      void newTab(editor);
    },
    onCloseOthers: (id) => {
      void closeOtherTabs(id, editor);
    },
    onCloseToRight: (id) => {
      void closeTabsToRight(id, editor);
    },
    onOpenInNewWindow: (id) => {
      void openTabInNewWindow(id, editor);
    },
    onCopyPath: (id) => {
      void copyTabPath(id);
    },
    onHtmlPreview: (id) => {
      // 右クリックしたタブをアクティブにしてから、その内容でプレビューを開く
      void (async () => {
        store.setActive(id);
        const a = store.getActive();
        if (a) await editor.show(a);
        await openHtmlPreviewTab(editor);
      })();
    },
    onPresentation: (id) => {
      // 右クリックしたタブをアクティブにしてから、その内容でプレゼンを開く
      void (async () => {
        store.setActive(id);
        const a = store.getActive();
        if (a) await editor.show(a);
        await openPresentationPreviewTab(editor);
      })();
    },
    onToggleSource: (id) => {
      // 右クリックしたタブをアクティブにしてからソース表示をトグルする。
      void (async () => {
        store.setActive(id);
        const a = store.getActive();
        if (a) await editor.show(a);
        editor.toggleSourceMode(id);
      })();
    },
    onPrint: (id) => {
      // 右クリックしたタブをアクティブにしてから印刷する（印刷はアクティブタブ対象）。
      void (async () => {
        store.setActive(id);
        const a = store.getActive();
        if (a) await editor.show(a);
        fileActions.file_print?.();
      })();
    },
    onRefreshPreview: (id) => void refreshPreviewTab(id, editor),
    canRefreshPreview: (id) => {
      const tab = store.getState().tabs.find((t) => t.id === id);
      return tab ? canRefreshPreviewTab(tab, editor) : false;
    },
    onDragMove: (sx, sy) => onTabDragMove(sx, sy),
    onDragEnd: () => onTabDragEnd(),
    onTearOff: (id, pos) => {
      void (async () => {
        const label = getCurrentWindow().label;
        let target: string | null = null;
        try {
          target = await invoke<string | null>("find_drop_target", {
            x: pos.x,
            y: pos.y,
            sourceLabel: label,
          });
        } catch (e) {
          console.warn("find_drop_target failed:", e);
        }
        if (target) {
          // 別ウィンドウのタブバー上で離した → 結合（単一タブでも許可）。
          await transferTabToWindow(id, target, editor);
        } else if (store.getState().tabs.length > 1) {
          // どのタブバーにも乗っていない → 新規ウィンドウ化（単一タブでは何もしない）。
          await openTabInNewWindow(id, editor, pos);
        }
      })();
    },
  });

  // ファイル系メニューアクション
  const fileActions: Record<string, () => void> = {
    file_new: () => void newTab(editor),
    file_open: () => void openFileFromDialog(editor),
    file_save: () => {
      const a = store.getActive();
      if (a) void saveTab(a.id, editor);
    },
    file_save_as: () => {
      const a = store.getActive();
      if (a) void saveTabAs(a.id, editor);
    },
    file_export_html: () => void exportActiveTabAsHtml(editor),
    file_html_preview: () => void openHtmlPreviewTab(editor),
    file_presentation: () => void openPresentationPreviewTab(editor),
    file_pres_pdf: () =>
      void import("./presentation-export").then((m) =>
        m.exportPresentationPdf(editor),
      ),
    file_pres_html: () =>
      void import("./presentation-export").then((m) =>
        m.exportPresentationAsHtml(editor),
      ),
    file_print: () =>
      void import("./print").then((m) => m.printActiveTab(editor)),
    file_close: () => {
      const a = store.getActive();
      if (a) void closeTab(a.id, editor);
    },
  };

  // 表示メニューアクション
  const viewActions: Record<string, () => void> = {
    view_zoom_in: () => settings.changeFontSize(1),
    view_zoom_out: () => settings.changeFontSize(-1),
    view_zoom_reset: () => settings.resetFontSize(),
    view_font: () =>
      void import("./settings-modal").then((m) => m.openFontSettings()),
    view_outline: () => settings.toggleOutline(),
    view_source: () => {
      const a = store.getActive();
      if (a) editor.toggleSourceMode(a.id);
    },
    // プレゼンタブのときだけ、デッキ／一覧モードを切り替える（Alt+V→D）。
    view_present_toggle: () => {
      const a = store.getActive();
      if (a?.kind === "preview" && a.previewMode === "slideshow") {
        togglePresentationView(a.id);
      }
    },
    view_expand_all: () => {
      // HTMLプレビュー（export）タブでは本文の折りたたみを解除する。
      const a = store.getActive();
      if (a?.kind === "preview") {
        if (a.previewMode === "export") expandAllPreviewFolds();
        return;
      }
      const v = editor.getActiveView();
      if (!v) return;
      expandAllHeadingFolds(v);
      expandAllListFolds(v);
    },
  };

  // ヘルプメニューアクション
  const helpActions: Record<string, () => void> = {
    help_about: () => void openAboutModal(),
  };

  // ツールバー（ファイル系・表示系もボタンに含めるためmergeしてから渡す）
  const fmtActions = makeToolbarActions(editor);
  createToolbar(toolbarEl, { ...fileActions, ...viewActions, ...fmtActions });

  // アクティブタブ種別に応じてツールバーを切り替える:
  //  - 編集タブ: 通常の編集ボタン。
  //  - プレビュー系タブ: 編集用ボタン（H1以降）を隠す。
  //  - プレゼンタブ: 空いた場所にプレゼン操作バーを差し込む。
  const presSlot = () => document.getElementById("toolbar-pres-slot");
  const syncPresentationChrome = () => {
    const a = store.getActive();
    const kind =
      !a || a.kind !== "preview" ? "editor" : a.previewMode ?? "export";
    document.body.dataset.tabkind = kind;
    const slot = presSlot();
    if (!slot) return;
    slot.replaceChildren();
    if (a?.kind === "preview" && a.previewMode === "slideshow") {
      const tb = getPresentationToolbar(a.id);
      if (tb) slot.appendChild(tb);
    }
  };
  setPresentationChromeSync(syncPresentationChrome);
  store.subscribe(syncPresentationChrome);
  syncPresentationChrome();

  // ── HTMLメニューバー（Alt 操作対応） ──────────────
  const editOps = makeEditOps(editor);
  const basename = (p: string) => p.split(/[\\/]/).pop() || p;
  let recentFiles: string[] = [];

  const openRecent = async (path: string) => {
    try {
      const content = await invoke<string>("read_file", { path });
      if (/\.html?$/i.test(path)) {
        await openHtmlFileTab(path, content, editor);
      } else {
        await openOrSwitch(path, content, editor);
      }
    } catch {
      void message(t("open.notFound").replace("{path}", path), {
        title: t("open.notFoundTitle"),
        kind: "error",
      });
    }
  };

  // アクティブタブがプレゼン（スライドショー）プレビューか。
  const isSlideshowActive = (): boolean => {
    const a = store.getActive();
    return a?.kind === "preview" && a.previewMode === "slideshow";
  };

  const buildMenus = (): TopMenu[] => [
    {
      id: "file",
      label: t("menu.file"),
      mnemonic: "F",
      onOpen: async () => {
        try {
          recentFiles = await invoke<string[]>("list_recent_files");
        } catch {
          recentFiles = [];
        }
      },
      items: () => {
        const items: MenuEntry[] = [
          { type: "item", label: t("menu.new"), mnemonic: "N", accel: "Ctrl+N", run: fileActions.file_new },
          { type: "item", label: t("menu.open"), mnemonic: "O", accel: "Ctrl+O", run: fileActions.file_open },
          { type: "sep" },
          { type: "item", label: t("menu.save"), mnemonic: "S", accel: "Ctrl+S", run: fileActions.file_save },
          { type: "item", label: t("menu.saveAs"), mnemonic: "A", accel: "Ctrl+Shift+S", run: fileActions.file_save_as },
          { type: "sep" },
          // 出力・表示系は「プレビュー → 出力 → 印刷 → プレゼン → プレゼン出力」の順。
          { type: "item", label: t("menu.htmlPreview"), mnemonic: "H", accel: "Ctrl+Shift+V", run: fileActions.file_html_preview },
          { type: "item", label: t("menu.exportHtml"), mnemonic: "E", accel: "Ctrl+Shift+E", run: fileActions.file_export_html },
          { type: "item", label: t("menu.print"), mnemonic: "P", accel: "Ctrl+P", run: fileActions.file_print },
          { type: "item", label: t("menu.presentation"), mnemonic: "R", accel: "Ctrl+Shift+P", run: fileActions.file_presentation },
          { type: "item", label: t("menu.presentationHtml"), mnemonic: "L", run: fileActions.file_pres_html },
          { type: "item", label: t("menu.presentationPdf"), mnemonic: "D", run: fileActions.file_pres_pdf },
        ];
        // 最近開いたファイルは「閉じる」の区切り線の直前に置く。
        if (settings.get().showRecent && recentFiles.length > 0) {
          items.push({ type: "sep" });
          for (const path of recentFiles.slice(0, 10)) {
            items.push({ type: "item", label: basename(path), run: () => void openRecent(path) });
          }
        }
        items.push(
          { type: "sep" },
          { type: "item", label: t("menu.close"), mnemonic: "C", accel: "Ctrl+W", run: fileActions.file_close },
          { type: "sep" },
          { type: "item", label: t("menu.quit"), mnemonic: "Q", run: () => void getCurrentWindow().close() },
        );
        return items;
      },
    },
    {
      id: "edit",
      label: t("menu.edit"),
      mnemonic: "E",
      items: () => [
        { type: "item", label: t("menu.undo"), mnemonic: "U", accel: "Ctrl+Z", run: editOps.undo },
        { type: "item", label: t("menu.redo"), mnemonic: "R", accel: "Ctrl+Y", run: editOps.redo },
        { type: "sep" },
        { type: "item", label: t("menu.cut"), mnemonic: "T", accel: "Ctrl+X", run: editOps.cut },
        { type: "item", label: t("menu.copy"), mnemonic: "C", accel: "Ctrl+C", run: editOps.copy },
        { type: "item", label: t("menu.paste"), mnemonic: "P", accel: "Ctrl+V", run: editOps.paste },
        { type: "item", label: t("menu.selectAll"), mnemonic: "A", accel: "Ctrl+A", run: editOps.selectAll },
      ],
    },
    {
      id: "format",
      label: t("menu.format"),
      mnemonic: "O",
      items: () => [
        { type: "item", label: t("menu.bold"), mnemonic: "B", accel: "Ctrl+B", run: fmtActions.fmt_bold },
        { type: "item", label: t("menu.italic"), mnemonic: "I", accel: "Ctrl+I", run: fmtActions.fmt_italic },
        { type: "item", label: t("menu.underline"), mnemonic: "D", accel: "Ctrl+U", run: fmtActions.fmt_underline },
        { type: "item", label: t("menu.textColor"), mnemonic: "F", run: fmtActions.fmt_text_color_menu },
        { type: "item", label: t("menu.strike"), mnemonic: "S", accel: "Ctrl+Shift+X", run: fmtActions.fmt_strike },
        { type: "item", label: t("menu.code"), mnemonic: "C", accel: "Ctrl+E", run: fmtActions.fmt_code },
        { type: "sep" },
        { type: "item", label: t("menu.h1"), mnemonic: "1", accel: "Ctrl+Alt+1", run: fmtActions.fmt_h1 },
        { type: "item", label: t("menu.h2"), mnemonic: "2", accel: "Ctrl+Alt+2", run: fmtActions.fmt_h2 },
        { type: "item", label: t("menu.h3"), mnemonic: "3", accel: "Ctrl+Alt+3", run: fmtActions.fmt_h3 },
        { type: "sep" },
        { type: "item", label: t("menu.quote"), mnemonic: "Q", run: fmtActions.fmt_quote },
        { type: "item", label: t("menu.bullet"), mnemonic: "U", run: fmtActions.fmt_bullet },
        { type: "item", label: t("menu.ordered"), mnemonic: "N", run: fmtActions.fmt_ordered },
        { type: "item", label: t("menu.codeblock"), mnemonic: "K", run: fmtActions.fmt_codeblock },
        { type: "item", label: t("menu.table"), mnemonic: "T", run: fmtActions.fmt_table },
        { type: "item", label: t("menu.hr"), mnemonic: "H", run: fmtActions.fmt_hr },
        { type: "sep" },
        { type: "item", label: t("menu.link"), mnemonic: "L", accel: "Ctrl+K", run: fmtActions.fmt_link },
      ],
    },
    {
      id: "view",
      label: t("menu.view"),
      mnemonic: "V",
      items: () => [
        { type: "item", label: t("menu.zoomIn"), mnemonic: "I", accel: "Ctrl++", run: viewActions.view_zoom_in },
        { type: "item", label: t("menu.zoomOut"), mnemonic: "O", accel: "Ctrl+-", run: viewActions.view_zoom_out },
        { type: "item", label: t("menu.zoomReset"), mnemonic: "R", accel: "Ctrl+0", run: viewActions.view_zoom_reset },
        { type: "sep" },
        {
          type: "item",
          label: t("menu.outline"),
          mnemonic: "L",
          accel: "Ctrl+Shift+O",
          // プレゼンタブではアウトラインは出さない（プレゼンが自前のサムネ一覧を持つ）。
          enabled: () => !isSlideshowActive(),
          run: viewActions.view_outline,
        },
        {
          type: "item",
          label: t("menu.source"),
          mnemonic: "U",
          accel: "Ctrl+Shift+I",
          // ソース表示は編集タブ専用（プレビュー各種では無効）。
          enabled: () => store.getActive()?.kind !== "preview",
          run: viewActions.view_source,
        },
        {
          type: "item",
          label: t("menu.expandAll"),
          mnemonic: "E",
          // プレゼンタブでは折りたたみ概念がないため無効。
          enabled: () => !isSlideshowActive(),
          run: viewActions.view_expand_all,
        },
        {
          type: "item",
          label: t("menu.presentToggle"),
          mnemonic: "D",
          // プレゼンタブのときだけ有効。それ以外ではグレーアウトする（設定の直上に配置）。
          enabled: () => isSlideshowActive(),
          run: viewActions.view_present_toggle,
        },
        { type: "item", label: t("menu.settings"), mnemonic: "S", accel: "Ctrl+,", run: viewActions.view_font },
      ],
    },
    {
      id: "help",
      label: t("menu.help"),
      mnemonic: "H",
      items: () => [
        { type: "item", label: t("menu.about"), mnemonic: "A", run: helpActions.help_about },
      ],
    },
  ];

  let menuBar = createMenuBar(menubarEl, buildMenus(), {
    onClose: () => editor.focus(),
  });
  // 言語切替時はラベルが変わるので作り直す。
  onLangChange(() => {
    menuBar.destroy();
    menuBar = createMenuBar(menubarEl, buildMenus(), {
      onClose: () => editor.focus(),
    });
  });

  // 右クリックメニュー:
  //  - エディタ本文の上では独自の文脈対応メニューを表示する。
  //  - それ以外（タブ・左パネル・ツールバー等）では WebView2 標準メニューを抑止。
  const editorContextMenu = createEditorContextMenu(editor, fmtActions, find);
  document.addEventListener(
    "contextmenu",
    (e) => {
      const target = e.target as Element | null;
      if (target?.closest(".editor-pane .ProseMirror")) {
        editorContextMenu(e);
      } else if (target?.closest(".preview-pane")) {
        // プレビューペイン上では「更新」メニューを出す。
        e.preventDefault();
        const pane = target.closest(".preview-pane") as HTMLElement;
        const tabId = pane.dataset.tabId ?? null;
        const tab = tabId
          ? store.getState().tabs.find((t) => t.id === tabId)
          : null;
        // 右クリックしたプレビューをアクティブにしてから印刷/出力を実行する
        // （印刷・HTML出力はアクティブタブを対象にするため）。
        const activateThenRun = (fn: () => void) => {
          void (async () => {
            if (tabId) {
              store.setActive(tabId);
              const a = store.getActive();
              if (a) await editor.show(a);
            }
            fn();
          })();
        };
        // 印刷・HTML出力は「export プレビュー」でのみ有効（外部HTMLファイルは対象外）。
        const exportable = !!tab && tab.previewMode === "export";
        const isSlide = !!tab && tab.previewMode === "slideshow";
        // スライドタイル/サムネを右クリックしたら、そのスライドを選択してから出す。
        if (isSlide && tabId) {
          const thumbEl = target.closest<HTMLElement>(".slide-thumb");
          const idx = thumbEl?.dataset.index;
          if (idx !== undefined) selectPresentationSlide(tabId, Number(idx));
        }
        const items: MenuItem[] = [];
        // プレゼンタブでは、発表・レーザー・デッキ/一覧切替を先頭に出す。
        if (isSlide && tabId) {
          items.push(
            {
              type: "item",
              label: t("pres.present"),
              shortcut: "F5",
              action: () => startPresentation(tabId, true),
            },
            {
              type: "item",
              label: t("pres.presentHere"),
              shortcut: "Shift+F5",
              action: () => startPresentation(tabId, false),
            },
            {
              type: "item",
              label: t("menu.presentToggle"),
              shortcut: "G",
              // 発表（フルスクリーン）中はデッキ固定のため切替不可。
              disabled: isPresentationFullscreen(tabId),
              action: () => togglePresentationView(tabId),
            },
            {
              type: "item",
              label: t("pres.laserMenu"),
              shortcut: "L",
              // 一覧モードではレーザーは使わないのでグレーアウト。
              disabled: isPresentationGridView(tabId),
              action: () => togglePresentationLaser(tabId),
            },
            { type: "separator" },
          );
        }
        items.push(
          {
            type: "item",
            label: t("previewcm.refresh"),
            shortcut: "F5",
            disabled: !tab || !canRefreshPreviewTab(tab, editor),
            action: () => {
              if (tabId) void refreshPreviewTab(tabId, editor);
            },
          },
          { type: "separator" },
          {
            type: "item",
            label: t("menu.print"),
            shortcut: "Ctrl+P",
            disabled: !exportable,
            action: () => activateThenRun(() => fileActions.file_print?.()),
          },
          {
            type: "item",
            label: t("menu.exportHtml"),
            shortcut: "Ctrl+Shift+E",
            disabled: !exportable,
            action: () => activateThenRun(() => fileActions.file_export_html?.()),
          },
          {
            type: "item",
            label: t("menu.presentationPdf"),
            disabled: !exportable,
            action: () => activateThenRun(() => fileActions.file_pres_pdf?.()),
          },
          {
            type: "item",
            label: t("menu.presentationHtml"),
            disabled: !exportable,
            action: () => activateThenRun(() => fileActions.file_pres_html?.()),
          },
        );
        showContextMenu(e.clientX, e.clientY, items);
      } else {
        e.preventDefault();
      }
    },
    { capture: true },
  );

  // アウトライン表示トグルボタンの active 状態を設定に同期（ツールバー生成後）。
  const syncOutlineButton = () => {
    const btn = toolbarEl.querySelector('[data-action="view_outline"]');
    btn?.classList.toggle("is-active", settings.get().showOutline);
  };
  syncOutlineButton();
  settings.subscribe(syncOutlineButton);

  setupTitle();
  setupShortcuts(editor, fileActions, find);

  if (isTauriContext()) {
    // メニューは上で生成した HTML メニューバーを使う（ネイティブメニューは廃止）。

    // このウィンドウのハンドル。イベント購読はこのウィンドウ宛てのみを受け取る
    // よう、グローバル listen ではなく appWin.listen を使う（emit_to で
    // フォーカス中ウィンドウに送ったイベントが全ウィンドウで発火しないように）。
    const appWin = getCurrentWindow();

    // メニュー操作・ファイルオープンの宛先特定に使う「直近フォーカス」を Rust に通知。
    // メニュー操作時は webview の is_focused が false になるため、これで補う。
    const markFocused = () =>
      void invoke("set_last_focused", { label: appWin.label }).catch(() => {});
    markFocused();
    await appWin.onFocusChanged(({ payload }) => {
      if (payload) markFocused();
    });

    // 切り離し（新規ウィンドウ化）で移送されてきたタブがあれば、起動直後の
    // 空タブの代わりにそれを開く。
    try {
      const moved = await invoke<MovedTabPayload | null>("take_pending_tab", {
        label: appWin.label,
      });
      if (moved) await openMovedTab(moved, editor);
    } catch (e) {
      console.warn("take_pending_tab failed:", e);
    }

    // Phase 3: このウィンドウのタブバー画面矩形（logical px）を Rust に登録する。
    // 別ウィンドウからの切り離しドラッグが、ここに乗ったかのヒットテストに使う。
    // あわせて、ビューポート左端の画面 logical X を保持し、結合ドラッグの青線位置の
    // 画面座標→ビューポート座標変換に使う。
    let winViewportLeftLogical = 0;
    const registerTabbarRect = async () => {
      try {
        const scale = await appWin.scaleFactor();
        const inner = await appWin.innerPosition(); // 物理px（webview 左上）
        const r = tabbarEl.getBoundingClientRect();
        winViewportLeftLogical = inner.x / scale;
        await invoke("register_tabbar_rect", {
          label: appWin.label,
          x: winViewportLeftLogical + r.left,
          y: inner.y / scale + r.top,
          w: r.width,
          h: r.height,
        });
      } catch (e) {
        console.warn("register_tabbar_rect failed:", e);
      }
    };
    await registerTabbarRect();
    await appWin.onMoved(() => void registerTabbarRect());
    await appWin.onResized(() => void registerTabbarRect());

    // 別ウィンドウから移送されてきたタブを受け取って追加する（このウィンドウ宛てのみ）。
    await appWin.listen<MovedTabPayload>("add-moved-tab", (event) => {
      // 結合が成立したので青線は確実に消す（イベント順序に依存しない保険）。
      tabbar.hideExternalDropIndicator();
      void openMovedTab(event.payload, editor).then(() => editor.focus());
    });

    // 結合ドラッグ中、このウィンドウが結合先のとき青い挿入インジケータを表示する。
    await appWin.listen<number>("tabbar-dragover", (event) => {
      const clientX = event.payload - winViewportLeftLogical;
      tabbar.showExternalDropIndicator(clientX);
    });
    await appWin.listen("tabbar-dragleave", () => {
      tabbar.hideExternalDropIndicator();
    });

    // このウィンドウが開いているファイル一覧を全体レジストリへ同期（二重オープン検知用）。
    void syncOpenFiles();
    store.subscribe(() => void syncOpenFiles());

    // 別ウィンドウから「このファイルを前面で表示して」と要求されたらタブをアクティブ化。
    await appWin.listen<string>("activate-file", (event) => {
      const tab = store.findByPath(event.payload);
      if (tab) {
        store.setActive(tab.id);
        editor.focus();
      }
    });

    // 設定で「最近使ったファイル表示」のオンオフをRustに反映
    const syncRecentVisible = (show: boolean) => {
      void invoke("set_recent_visible", { show }).catch((e) =>
        console.warn("set_recent_visible failed:", e),
      );
    };
    const syncLang = (lang: string) => {
      void invoke("set_lang", { lang }).catch((e) =>
        console.warn("set_lang failed:", e),
      );
    };
    syncRecentVisible(settings.get().showRecent);
    // Rust側に渡すのは解決済みの "ja"|"en"（"system" は受け取れない）
    syncLang(settings.getEffectiveLang());
    let lastShowRecent = settings.get().showRecent;
    let lastEffectiveLang = settings.getEffectiveLang();
    settings.subscribe((s) => {
      if (s.showRecent !== lastShowRecent) {
        lastShowRecent = s.showRecent;
        syncRecentVisible(s.showRecent);
      }
      const eff = settings.getEffectiveLang();
      if (eff !== lastEffectiveLang) {
        lastEffectiveLang = eff;
        syncLang(eff);
      }
    });

    await appWin.listen<OpenFilePayload>("open-file", (event) => {
      const { path, content } = event.payload;
      // アプリアイコンへのD&D・関連付け起動など外部からのオープンでも、
      // .html/.htm はウィンドウへのD&Dと同じくサンドボックスiframeのプレビューで開く。
      if (/\.html?$/i.test(path)) {
        void openHtmlFileTab(path, content, editor);
      } else {
        void openOrSwitch(path, content, editor);
      }
    });

    // 履歴・関連付け起動などでファイルが見つからない/読めないときの通知。
    await appWin.listen<string>("open-file-error", (event) => {
      const path = event.payload;
      void message(t("open.notFound").replace("{path}", path), {
        title: t("open.notFoundTitle"),
        kind: "error",
      });
    });

    await appWin.listen<string>("menu-action", (event) => {
      const id = event.payload;
      const fn =
        fileActions[id] ?? viewActions[id] ?? fmtActions[id] ?? helpActions[id];
      if (fn) fn();
    });

    const win = appWin;

    await win.onDragDropEvent(async (event) => {
      if (event.payload.type !== "drop") return;
      const paths = event.payload.paths.filter((p) =>
        /\.(md|markdown|mmd|mermaid|html?|htm)$/i.test(p),
      );
      for (const path of paths) {
        try {
          const content = await invoke<string>("read_file", { path });
          if (/\.html?$/i.test(path)) {
            await openHtmlFileTab(path, content, editor);
          } else {
            await openOrSwitch(path, content, editor);
          }
        } catch (e) {
          console.error("drop open failed:", path, e);
        }
      }
    });

    await win.onCloseRequested(async (event) => {
      if (!store.hasAnyDirty()) return;
      event.preventDefault();
      const choice = await confirmCloseAll();
      if (choice === "cancel") return;
      if (choice === "review") {
        const firstDirty = store
          .getState()
          .tabs.find((t) => store.isDirty(t.id));
        if (firstDirty) store.setActive(firstDirty.id);
        return;
      }
      await win.destroy();
    });

    mark("frontend_ready (bootstrap end)");
    try {
      await invoke<void>("frontend_ready");
    } catch (e) {
      console.error("frontend_ready failed:", e);
    }
  }

  editor.focus();
}

bootstrap().catch((err) => {
  console.error("bootstrap failed:", err);
  // 起動に失敗したら白画面のままにせず、原因を画面に出す。
  const pre = document.createElement("pre");
  pre.style.cssText =
    "position:fixed;inset:0;margin:0;padding:16px;overflow:auto;" +
    "background:#1e1e1e;color:#e85c4a;font:13px/1.5 monospace;white-space:pre-wrap;z-index:99999;";
  pre.textContent = `bootstrap failed:\n${(err && err.stack) || String(err)}`;
  document.body.appendChild(pre);
});
