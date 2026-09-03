/**
 * 表の最終セルの文末で Tab を押したときに行を追加するキーマップ処理。
 *
 * GFM プリセットの Tab は「次のセルへ移動」で、最終セルでは何も起きない。
 * Word と同様に末尾へ新しい行を追加し、その先頭セルへキャレットを移す。
 * ただしセル内に Tab を入力したいケースを妨げないよう、キャレットがセル内容の
 * 文末（最後の段落の末尾）にあるときだけ作用する。
 */
import type { EditorState, Transaction } from "@milkdown/kit/prose/state";
import { TextSelection } from "@milkdown/kit/prose/state";
import {
  TableMap,
  addRow,
  isInTable,
  selectedRect,
} from "@milkdown/kit/prose/tables";

/** $pos を含むセル（tableRole が cell / header_cell）の深さ。無ければ -1。 */
function cellDepth($pos: EditorState["selection"]["$head"]): number {
  for (let d = $pos.depth; d > 0; d--) {
    const role = $pos.node(d).type.spec.tableRole;
    if (role === "cell" || role === "header_cell") return d;
  }
  return -1;
}

export function addRowOnTabAtLastCell(
  state: EditorState,
  dispatch?: (tr: Transaction) => void,
): boolean {
  const { selection } = state;
  if (!selection.empty || !(selection instanceof TextSelection)) return false;
  if (!isInTable(state)) return false;

  const $head = selection.$head;
  const d = cellDepth($head);
  if (d < 0) return false;

  // 文末判定: キャレットがセル内の最後のブロックの末尾にある。
  if ($head.parentOffset !== $head.parent.content.size) return false;
  const cell = $head.node(d);
  if ($head.index(d) !== cell.childCount - 1) return false;

  // 最終セル判定: 選択セルの矩形が表の右下隅に接している。
  const rect = selectedRect(state);
  if (rect.bottom !== rect.map.height || rect.right !== rect.map.width)
    return false;

  if (dispatch) {
    const tr = addRow(state.tr, rect, rect.bottom);
    // 追加後の表を再解釈し、新行（インデックス rect.bottom）の先頭セルへ移動する。
    const table = tr.doc.nodeAt(rect.tableStart - 1);
    if (table) {
      const map = TableMap.get(table);
      const cellPos = rect.tableStart + map.positionAt(rect.bottom, 0, table);
      tr.setSelection(TextSelection.near(tr.doc.resolve(cellPos + 1)));
    }
    dispatch(tr.scrollIntoView());
  }
  return true;
}
