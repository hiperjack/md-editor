import { undo, redo } from "@milkdown/kit/prose/history";
import { selectAll as pmSelectAll } from "@milkdown/kit/prose/commands";
import type { EditorView } from "@milkdown/kit/prose/view";
import type { EditorHost } from "./editor";

/**
 * 編集メニュー（元に戻す/やり直し/切り取り/コピー/貼り付け/すべて選択）の実体。
 * アクティブな ProseMirror ビューに対して操作する。プレビュータブなどビューが
 * 無い場合は何もしない。
 */
export interface EditOps {
  undo: () => void;
  redo: () => void;
  cut: () => void;
  copy: () => void;
  paste: () => void;
  selectAll: () => void;
}

export function makeEditOps(editor: EditorHost): EditOps {
  const withView = (fn: (v: EditorView) => void) => {
    const v = editor.getActiveView();
    if (!v) return;
    v.focus();
    fn(v);
  };

  return {
    undo: () => withView((v) => undo(v.state, v.dispatch)),
    redo: () => withView((v) => redo(v.state, v.dispatch)),
    // コピー/切り取りは ProseMirror の clipboard シリアライズを使うため、
    // フォーカス済みエディタ上で execCommand を発火する。
    copy: () =>
      withView(() => {
        document.execCommand("copy");
      }),
    cut: () =>
      withView(() => {
        document.execCommand("cut");
      }),
    selectAll: () => withView((v) => pmSelectAll(v.state, v.dispatch)),
    // execCommand("paste") は Chromium で不可のため、Clipboard API でテキストを
    // 取得して挿入する（プレーンテキスト貼り付け。Ctrl+V は従来どおりリッチ対応）。
    paste: () =>
      withView((v) => {
        void navigator.clipboard
          .readText()
          .then((text) => {
            if (text) v.dispatch(v.state.tr.insertText(text).scrollIntoView());
          })
          .catch((e) => console.warn("paste failed:", e));
      }),
  };
}
