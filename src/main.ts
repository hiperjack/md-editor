import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { store } from "./store";
import { createEditorHost } from "./editor";
import { createTabBar } from "./tabs";
import { createToolbar, makeToolbarActions } from "./toolbar";
import { setupTitle } from "./title";
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
import { openFontSettings } from "./settings-modal";
import { exportActiveTabAsHtml, openHtmlPreviewTab, openHtmlFileTab, refreshPreviewTab, canRefreshPreview as canRefreshPreviewTab } from "./exporter";
import { showContextMenu, type MenuItem } from "./context-menu";
import { printActiveTab } from "./print";
import { installDiagramViewerTrigger } from "./diagram-viewer";
import { setMermaidColorScheme } from "./mermaid-renderer";
import { setLang, t } from "./i18n";
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
  const tabbarEl = document.getElementById("tabbar");
  const toolbarEl = document.getElementById("toolbar");
  const editorHostEl = document.getElementById("editor-host");
  if (!tabbarEl || !toolbarEl || !editorHostEl) {
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
      if (key === "f5" || (mod && key === "r")) {
        e.preventDefault();
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

      // Ctrl+Shift+I: DevTools(inspect) を抑止。
      if (e.shiftKey && key === "i") {
        e.preventDefault();
        return;
      }

      // Ctrl+P: 文書テーマを適用した印刷（print.ts）。WebView2標準の印刷は抑止。
      if (key === "p") {
        e.preventDefault();
        fileActions.file_print?.();
        return;
      }
    },
    { capture: true },
  );

  const editor = createEditorHost(editorHostEl);
  const find = createFindReplace(editor);
  const outline = createOutlinePanel(editor);

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
    file_print: () => void printActiveTab(editor),
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
    view_font: () => void openFontSettings(),
    view_outline: () => settings.toggleOutline(),
  };

  // ツールバー（ファイル系・表示系もボタンに含めるためmergeしてから渡す）
  const fmtActions = makeToolbarActions(editor);
  createToolbar(toolbarEl, { ...fileActions, ...viewActions, ...fmtActions });

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
        const items: MenuItem[] = [
          {
            type: "item",
            label: t("previewcm.refresh"),
            disabled: !tab || !canRefreshPreviewTab(tab, editor),
            action: () => {
              if (tabId) void refreshPreviewTab(tabId, editor);
            },
          },
        ];
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
    // このウィンドウ専用のネイティブメニューを割り当てる（HMENU を共有しない）。
    void invoke("init_window_menu").catch((e) =>
      console.warn("init_window_menu failed:", e),
    );

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
      void openOrSwitch(path, content, editor);
    });

    await appWin.listen<string>("menu-action", (event) => {
      const id = event.payload;
      const fn = fileActions[id] ?? viewActions[id] ?? fmtActions[id];
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
