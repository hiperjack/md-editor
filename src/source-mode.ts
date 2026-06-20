import {
  EditorView,
  lineNumbers,
  keymap,
  drawSelection,
  highlightActiveLine,
  highlightActiveLineGutter,
} from "@codemirror/view";
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
  /** 指定行（1始まり）へカーソルを移動しスクロールする。範囲外は丸める。 */
  scrollToLine: (oneBasedLine: number) => void;
  /** CodeMirror を破棄し DOM を外す。 */
  destroy: () => void;
};

/**
 * ソースペインの配色。アプリのテーマ変数（:root の --bg-* / --fg-* / --accent。
 * ライト/ダークで自動切替）を参照するため、テーマ追従でカーソルや選択が見える。
 */
const sourceTheme = EditorView.theme({
  "&": {
    height: "100%",
    backgroundColor: "var(--bg-0)",
    color: "var(--fg-0)",
  },
  ".cm-content": { caretColor: "var(--accent)" },
  ".cm-cursor, .cm-dropCursor": {
    borderLeftColor: "var(--accent)",
    borderLeftWidth: "2px",
  },
  "&.cm-focused .cm-selectionBackground, .cm-selectionBackground, .cm-content ::selection":
    {
      backgroundColor: "var(--bg-3)",
    },
  ".cm-activeLine": { backgroundColor: "var(--bg-1)" },
  ".cm-activeLineGutter": { backgroundColor: "var(--bg-1)", color: "var(--fg-0)" },
  ".cm-gutters": {
    backgroundColor: "var(--bg-0)",
    color: "var(--fg-2)",
    border: "none",
  },
});

/**
 * 生 Markdown を「プレーンテキスト＋行番号」で編集する CodeMirror ペインを作る。
 * シンタックスハイライトは付けない（言語拡張を入れない）。
 * undo/redo・基本キーバインド・Tab字下げ・行折り返し・カーソル/選択表示を有効化する。
 *
 * @param initial - 初期テキスト
 * @param onChange - テキスト変更コールバック。onChange は文字入力のたびに呼ばれる。高頻度なので必要なら呼び出し元でデバウンスすること。
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
        highlightActiveLine(),
        highlightActiveLineGutter(),
        drawSelection(),
        history(),
        keymap.of([indentWithTab, ...defaultKeymap, ...historyKeymap]),
        EditorView.lineWrapping,
        sourceTheme,
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
    scrollToLine: (oneBasedLine: number) => {
      const total = view.state.doc.lines;
      const ln = Math.max(1, Math.min(oneBasedLine, total));
      const line = view.state.doc.line(ln);
      view.dispatch({
        selection: { anchor: line.from },
        effects: EditorView.scrollIntoView(line.from, { y: "start" }),
      });
      view.focus();
    },
    destroy: () => {
      view.destroy();
      dom.remove();
    },
  };
}
