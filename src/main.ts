import { listen } from "@tauri-apps/api/event";
import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { store } from "./store";
import { createEditorHost } from "./editor";
import { createTabBar } from "./tabs";
import { createToolbar, makeToolbarActions } from "./toolbar";
import { setupTitle } from "./title";
import { setupShortcuts } from "./shortcuts";
import { createFindReplace } from "./find-replace";
import {
  closeTab,
  newTab,
  openOrSwitch,
  openFileFromDialog,
  saveTab,
  saveTabAs,
} from "./actions";
import { confirmCloseAll } from "./modal";
import { settings } from "./settings";
import { openFontSettings } from "./settings-modal";
import { setLang } from "./i18n";
import "./style.css";

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

  // Ctrl+ホイール で文字サイズ変更（WebView2の標準ズームを抑止するためcapture+非passive）
  document.addEventListener(
    "wheel",
    (e) => {
      if (!e.ctrlKey) return;
      e.preventDefault();
      e.stopPropagation();
      const delta = e.deltaY > 0 ? -1 : 1;
      settings.changeFontSize(delta);
    },
    { passive: false, capture: true },
  );

  // Ctrl+= / Ctrl+- / Ctrl+0 のブラウザ標準ズームも抑止（メニュー側で処理）
  document.addEventListener(
    "keydown",
    (e) => {
      if (!(e.ctrlKey || e.metaKey)) return;
      if (e.key === "+" || e.key === "=" || e.key === "-" || e.key === "0") {
        // メニューaccelerator経由で処理されるはずなので、ここでは
        // ブラウザのデフォルトズーム動作だけを抑止する
        e.preventDefault();
      }
    },
    { capture: true },
  );

  const editor = createEditorHost(editorHostEl);
  const find = createFindReplace(editor);

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
        void editor.show(t).then(() => find.refresh());
      }
    }
  });

  createTabBar(tabbarEl, {
    onSelect: (id) => store.setActive(id),
    onClose: (id) => {
      void closeTab(id, editor);
    },
    onNew: () => {
      void newTab(editor);
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
  };

  // ツールバー（ファイル系・表示系もボタンに含めるためmergeしてから渡す）
  const fmtActions = makeToolbarActions(editor);
  createToolbar(toolbarEl, { ...fileActions, ...viewActions, ...fmtActions });

  setupTitle();
  setupShortcuts(editor, fileActions, find);

  if (isTauriContext()) {
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

    await listen<OpenFilePayload>("open-file", (event) => {
      const { path, content } = event.payload;
      void openOrSwitch(path, content, editor);
    });

    await listen<string>("menu-action", (event) => {
      const id = event.payload;
      const fn = fileActions[id] ?? viewActions[id] ?? fmtActions[id];
      if (fn) fn();
    });

    const win = getCurrentWindow();

    await win.onDragDropEvent(async (event) => {
      if (event.payload.type !== "drop") return;
      const paths = event.payload.paths.filter((p) =>
        /\.(md|markdown)$/i.test(p),
      );
      for (const path of paths) {
        try {
          const content = await invoke<string>("read_file", { path });
          await openOrSwitch(path, content, editor);
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
});
