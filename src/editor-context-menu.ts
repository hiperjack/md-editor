/**
 * エディタ本文の右クリックで開く独自コンテキストメニュー。
 * クリップボード操作・全選択に加え、選択テキストや画像ノードに応じて
 * フォーマット項目を出し分ける（文脈対応）。
 *
 * クリップボード方式（WebView2）:
 *  - コピー/切り取り: document.execCommand。ProseMirror のクリップボード
 *    直列化を通るのでリッチ内容を保持し、切り取りは undo 可能。
 *  - 貼り付け: WebView2 では execCommand("paste") が不可なことが多いため、
 *    navigator.clipboard.readText() で取得し、text/plain を載せた合成 paste
 *    イベントを view.dom に dispatch して PM の貼り付け処理に通す。PM が
 *    処理しなかった場合は素テキスト挿入にフォールバックする。
 */
import type { EditorView } from "@milkdown/kit/prose/view";
import { NodeSelection, TextSelection } from "@milkdown/kit/prose/state";
import type { EditorHost } from "./editor";
import type { FindReplaceController } from "./find-replace";
import { isImageNode } from "./image-edit";
import { showContextMenu, type MenuItem } from "./context-menu";
import { t } from "./i18n";

type Actions = Record<string, () => void>;

function copySelection(view: EditorView): void {
  view.focus();
  document.execCommand("copy");
}

function cutSelection(view: EditorView): void {
  view.focus();
  document.execCommand("cut");
}

function selectAll(view: EditorView): void {
  view.focus();
  const { doc } = view.state;
  view.dispatch(
    view.state.tr.setSelection(TextSelection.create(doc, 0, doc.content.size)),
  );
}

async function pasteFromClipboard(view: EditorView): Promise<void> {
  try {
    const text = await navigator.clipboard.readText();
    if (!text) return;
    view.focus();
    const dt = new DataTransfer();
    dt.setData("text/plain", text);
    const ev = new ClipboardEvent("paste", {
      clipboardData: dt,
      bubbles: true,
      cancelable: true,
    });
    view.dom.dispatchEvent(ev);
    // PM が貼り付けを処理すると preventDefault される。未処理なら素テキスト挿入。
    if (!ev.defaultPrevented) {
      const { from, to } = view.state.selection;
      view.dispatch(view.state.tr.insertText(text, from, to).scrollIntoView());
    }
  } catch (e) {
    console.warn("paste failed:", e);
  }
}

/**
 * contextmenu イベントを受け取り、文脈に応じたメニューを開くハンドラを作る。
 * @param actions toolbar の fmt_* アクション（フォーマット/画像編集に再利用）
 */
export function createEditorContextMenu(
  editor: EditorHost,
  actions: Actions,
  find: FindReplaceController,
): (e: MouseEvent) => void {
  return (e: MouseEvent) => {
    const view = editor.getActiveView();
    if (!view) return;
    e.preventDefault();

    // クリック座標からドキュメント位置を求め、選択を調整する。
    const posInfo = view.posAtCoords({ left: e.clientX, top: e.clientY });

    // 画像ブロック上の右クリックはそのノードを選択する
    // （editor.ts の wheel プラグインと同じ inside 判定）。
    let imagePos: number | null = null;
    if (posInfo && posInfo.inside >= 0) {
      const node = view.state.doc.nodeAt(posInfo.inside);
      if (node && isImageNode(node)) imagePos = posInfo.inside;
    }

    if (imagePos !== null) {
      view.dispatch(
        view.state.tr.setSelection(
          NodeSelection.create(view.state.doc, imagePos),
        ),
      );
    } else if (posInfo && view.state.selection.empty) {
      // 選択が無ければクリック位置へキャレットを移動（標準的な右クリック挙動）。
      view.dispatch(
        view.state.tr.setSelection(
          TextSelection.create(view.state.doc, posInfo.pos),
        ),
      );
    }
    view.focus();

    const sel = view.state.selection;
    const isImageSelected = sel instanceof NodeSelection && isImageNode(sel.node);
    const hasSelection = !sel.empty;
    const hasTextSelection = hasSelection && !isImageSelected;

    const items: MenuItem[] = [
      {
        type: "item",
        label: t("cm.cut"),
        disabled: !hasSelection,
        action: () => cutSelection(view),
      },
      {
        type: "item",
        label: t("cm.copy"),
        disabled: !hasSelection,
        action: () => copySelection(view),
      },
      {
        type: "item",
        label: t("cm.paste"),
        action: () => void pasteFromClipboard(editor.getActiveView() ?? view),
      },
      {
        type: "item",
        label: t("cm.selectAll"),
        action: () => selectAll(view),
      },
    ];

    if (hasTextSelection) {
      items.push(
        { type: "separator" },
        { type: "item", label: t("cm.bold"), action: () => actions.fmt_bold?.() },
        { type: "item", label: t("cm.italic"), action: () => actions.fmt_italic?.() },
        { type: "item", label: t("cm.link"), action: () => actions.fmt_link?.() },
      );
    }

    if (isImageSelected) {
      items.push(
        { type: "separator" },
        {
          type: "item",
          label: t("cm.editImage"),
          action: () => actions.fmt_image?.(),
        },
      );
    }

    items.push(
      { type: "separator" },
      { type: "item", label: t("cm.find"), action: () => find.openFind() },
    );

    showContextMenu(e.clientX, e.clientY, items);
  };
}
