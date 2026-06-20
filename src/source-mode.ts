import { EditorView, lineNumbers, keymap } from "@codemirror/view";
import { EditorState } from "@codemirror/state";
import {
  defaultKeymap,
  history,
  historyKeymap,
  indentWithTab,
} from "@codemirror/commands";

export type SourcePane = {
  /** ペインのルート要素（.source-pane）。container に append して使う。 */
  dom: HTMLElement;
  /** 現在のテキストを返す（保存・baseline 比較用）。 */
  getText: () => string;
  /** エディタにフォーカスする。 */
  focus: () => void;
  /** CodeMirror を破棄し DOM を外す。 */
  destroy: () => void;
};

/**
 * 生 Markdown を「プレーンテキスト＋行番号」で編集する CodeMirror ペインを作る。
 * シンタックスハイライトは付けない（言語拡張を入れない）。
 * undo/redo・基本キーバインド・Tab字下げ・行折り返しのみ有効化する。
 */
export function createSourcePane(
  initial: string,
  onChange: (text: string) => void,
): SourcePane {
  const dom = document.createElement("div");
  dom.className = "source-pane";

  const view = new EditorView({
    parent: dom,
    state: EditorState.create({
      doc: initial,
      extensions: [
        lineNumbers(),
        history(),
        keymap.of([indentWithTab, ...defaultKeymap, ...historyKeymap]),
        EditorView.lineWrapping,
        EditorView.updateListener.of((u) => {
          if (u.docChanged) onChange(u.state.doc.toString());
        }),
      ],
    }),
  });

  return {
    dom,
    getText: () => view.state.doc.toString(),
    focus: () => view.focus(),
    destroy: () => {
      view.destroy();
      dom.remove();
    },
  };
}
