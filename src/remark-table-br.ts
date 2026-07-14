/**
 * 表セル内の改行（GFM互換の <br> 方式）。
 *
 * GFMの表はセル内に生の改行を書けないため、GitHub等では <br> タグで
 * 改行を表現する。アプリは raw HTML をエスケープして扱う設計のため、
 * 全HTMLを有効化せず「tableCell 内の <br> 単体」だけを解釈する:
 *
 *  - パース: tableCell 配下の html ノードのうち <br>/<br/> を break ノードへ
 *    変換し、WYSIWYGで実際の改行として表示・編集できるようにする
 *    （セル外の <br> は従来どおり温存）。
 *  - 保存: editor.ts の remark-stringify break ハンドラが tableCell 構築中は
 *    "<br>" を出力する（ペアで変更すること）。
 *  - 出力HTML: render-pipeline.ts の tableCellBrPlugin が同じ規約で
 *    セル内の <br> テキストを hardbreak に変換する。
 */

export type TableBrMdastNode = {
  type: string;
  value?: string;
  children?: TableBrMdastNode[];
};

const BR_RE = /^<br\s*\/?>$/i;

/** tableCell 配下の <br> html ノードを break ノードへ変換する（破壊的）。 */
export function convertTableCellBr(
  node: TableBrMdastNode,
  inCell = false,
): void {
  const within = inCell || node.type === "tableCell";
  if (!Array.isArray(node.children)) return;
  for (const child of node.children) {
    if (within && child.type === "html" && BR_RE.test(child.value ?? "")) {
      child.type = "break";
      delete child.value;
      continue;
    }
    convertTableCellBr(child, within);
  }
}

/** remark プラグイン本体。mdast ツリーを直接書き換える。 */
export function remarkTableBr() {
  return (tree: TableBrMdastNode): void => {
    convertTableCellBr(tree);
  };
}
