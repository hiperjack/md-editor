import { store } from "./store";
import { settings } from "./settings";
import { openFontSettings } from "./settings-modal";
import type { EditorHost } from "./editor";
import type { FindReplaceController } from "./find-replace";

function isModifier(e: KeyboardEvent): boolean {
  return e.ctrlKey || e.metaKey;
}

function nextTabId(direction: 1 | -1): string | null {
  const { tabs, activeTabId } = store.getState();
  if (tabs.length === 0 || !activeTabId) return null;
  const idx = tabs.findIndex((t) => t.id === activeTabId);
  if (idx < 0) return null;
  const nextIdx = (idx + direction + tabs.length) % tabs.length;
  return tabs[nextIdx].id;
}

function tabIdAt(oneBasedIndex: number): string | null {
  const { tabs } = store.getState();
  const idx = oneBasedIndex - 1;
  if (idx < 0 || idx >= tabs.length) return null;
  return tabs[idx].id;
}

/**
 * キーボードショートカットを処理する。
 * WebView2 はメニュー accelerator を受け取らないことがあるため、
 * Ctrl+N/O/S/Shift+S/W といったファイル操作系もここで明示的に拾う。
 */
export function setupShortcuts(
  editor: EditorHost,
  fileActions: Record<string, () => void>,
  find: FindReplaceController,
): void {
  window.addEventListener(
    "keydown",
    (e) => {
      if (!isModifier(e)) return;

      // Mermaid図ビューア表示中は、Ctrl+Tab等のショートカットをビューアに譲る。
      if (document.querySelector(".diagram-viewer-overlay")) return;

      // 設定（Ctrl+,）。WebView2 がメニュー accelerator を取りこぼすため明示的に拾う。
      if (e.key === ",") {
        e.preventDefault();
        void openFontSettings();
        return;
      }

      // 印刷。Ctrl+P は独自印刷。Ctrl+Shift+P（Chromium標準のシステム印刷）は
      // エディタ画面そのものを印刷してしまうため抑止のみ（何もしない）。
      if (e.key.toLowerCase() === "p") {
        e.preventDefault();
        if (!e.shiftKey) fileActions.file_print?.();
        return;
      }

      // 文字サイズ（Ctrl + = / - / 0）。ネイティブメニュー撤去に伴い明示的に拾う。
      if (e.key === "=" || e.key === "+") {
        e.preventDefault();
        settings.changeFontSize(1);
        return;
      }
      if (e.key === "-") {
        e.preventDefault();
        settings.changeFontSize(-1);
        return;
      }
      if (e.key === "0") {
        e.preventDefault();
        settings.resetFontSize();
        return;
      }

      // タブ移動
      if (e.shiftKey && e.key === "Tab") {
        e.preventDefault();
        const id = nextTabId(-1);
        if (id) store.setActive(id);
        return;
      }
      if (!e.shiftKey && e.key === "Tab") {
        e.preventDefault();
        const id = nextTabId(1);
        if (id) store.setActive(id);
        return;
      }
      if (!e.shiftKey && /^[1-9]$/.test(e.key)) {
        e.preventDefault();
        const id = tabIdAt(parseInt(e.key, 10));
        if (id) store.setActive(id);
        return;
      }

      // 検索・置換（WebView2 標準のページ内検索を抑止して独自バーを開く）
      const k = e.key.toLowerCase();
      if (!e.shiftKey && k === "f") {
        e.preventDefault();
        find.openFind();
        return;
      }
      if (!e.shiftKey && k === "h") {
        e.preventDefault();
        find.openReplace();
        return;
      }

      // ファイル操作（メニュー accelerator が届かないケース対策）
      if (e.shiftKey) {
        if (k === "s") {
          e.preventDefault();
          fileActions.file_save_as?.();
          return;
        }
        // HTMLとして出力（Ctrl+E はインラインコードに割当済みのため Shift 付き）
        if (k === "e") {
          e.preventDefault();
          fileActions.file_export_html?.();
          return;
        }
        // HTMLの見た目を新規タブでプレビュー
        if (k === "v") {
          e.preventDefault();
          fileActions.file_html_preview?.();
          return;
        }
        // アウトラインパネルの表示トグル
        if (k === "o") {
          e.preventDefault();
          settings.toggleOutline();
          return;
        }
        // ソース表示トグル（Ctrl+Shift+I。既定の DevTools は main.ts で抑止解除済み）
        if (k === "i") {
          e.preventDefault();
          e.stopPropagation();
          const id = store.getActive()?.id;
          if (id) editor.toggleSourceMode(id);
          return;
        }
        return;
      }
      if (k === "n") {
        e.preventDefault();
        fileActions.file_new?.();
        return;
      }
      if (k === "o") {
        e.preventDefault();
        fileActions.file_open?.();
        return;
      }
      if (k === "s") {
        e.preventDefault();
        fileActions.file_save?.();
        return;
      }
      if (k === "w") {
        e.preventDefault();
        fileActions.file_close?.();
        return;
      }

    },
    { capture: true },
  );
}
