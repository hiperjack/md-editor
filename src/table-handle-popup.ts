/**
 * 表の列・行ハンドルに付く操作ポップアップ（Crepe の .button-group）の見切れ対策。
 *
 * Crepe はポップアップをハンドルの上 52px に絶対配置するが、エディタ領域
 * (.editor-pane) はスクロールコンテナなので、表が文書の 1〜2 行目にあると
 * 上端の外へはみ出して見えない（スクロールしても届かない）。
 * 列または行が選択されたタイミングで、表示中ハンドルとエディタ領域上端の
 * 距離を実測し、足りなければハンドルに data-popup-below を付けて CSS で
 * ポップアップをハンドルの下側へ反転表示する。
 */
import { Plugin } from "@milkdown/kit/prose/state";
import { CellSelection } from "@milkdown/kit/prose/tables";

/**
 * ポップアップがハンドル上側に収まるために必要な余白（px）。
 * Crepe の配置: top -52px、高さ ≈ 36px（ボタン 24px + margin 6px×2）。
 * 余裕を持たせて 60px。
 */
export const POPUP_SPACE_ABOVE = 60;

/** ハンドル上端 (handleTop) がエディタ領域上端 (paneTop) に近すぎるなら true。 */
export function shouldFlipPopupBelow(handleTop: number, paneTop: number): boolean {
  return handleTop - paneTop < POPUP_SPACE_ABOVE;
}

const FLIP_ATTR = "data-popup-below";

export const tableHandlePopupPlugin = new Plugin({
  view(editorView) {
    let raf: number | null = null;
    const apply = () => {
      raf = null;
      const pane =
        editorView.dom.closest<HTMLElement>(".editor-pane") ?? editorView.dom;
      const paneTop = pane.getBoundingClientRect().top;
      editorView.dom
        .querySelectorAll<HTMLElement>(
          '.milkdown-table-block .cell-handle .button-group[data-show="true"]',
        )
        .forEach((group) => {
          const handle = group.parentElement;
          if (!handle) return;
          const flip = shouldFlipPopupBelow(
            handle.getBoundingClientRect().top,
            paneTop,
          );
          handle.toggleAttribute(FLIP_ATTR, flip);
        });
    };
    return {
      update(view) {
        const sel = view.state.selection;
        if (!(sel instanceof CellSelection)) return;
        if (!sel.isColSelection() && !sel.isRowSelection()) return;
        // Crepe（Vue）がハンドル位置とポップアップ表示を更新した後に測る。
        if (raf !== null) cancelAnimationFrame(raf);
        raf = requestAnimationFrame(apply);
      },
      destroy() {
        if (raf !== null) cancelAnimationFrame(raf);
      },
    };
  },
});
