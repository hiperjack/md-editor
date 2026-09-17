/**
 * 外部アプリからの表貼り付け（text/html の <table>）の前処理。
 *
 * PowerPoint / Word はセル内の各行を別々の <p>（MsoNormal）として出力する。
 * 一方、Milkdown GFM の table_cell は content="paragraph"（段落 1 つ）なので、
 * ProseMirror の DOMParser は 2 つ目以降の <p> を同じセルに収められず、
 * 新しい table_cell を開いて右隣の列へ押し出してしまう（以降の列も 1 つずつずれる）。
 *
 * ここでは各 <td>/<th> の中に複数のブロック要素があるとき、それらの中身を
 * <br> で連結した 1 つの <p> にまとめる。<br> は parseDOM で hardbreak になり、
 * 保存時は GFM 互換の <br> としてシリアライズされる（remark-table-br.ts と対）。
 * Excel のように <br> を直書きするセルや、ブロックが 1 つだけのセルは触らない。
 */

const BLOCK_TAGS = new Set(["P", "DIV", "LI", "H1", "H2", "H3", "H4", "H5", "H6"]);

function isBlock(node: ChildNode): node is HTMLElement {
  return node.nodeType === 1 && BLOCK_TAGS.has((node as Element).tagName);
}

/** 空白テキストだけのノードか（<p> 間の改行やインデント）。 */
function isBlankText(node: ChildNode): boolean {
  return node.nodeType === 3 && !/\S/.test(node.textContent ?? "");
}

/**
 * doc 内すべての表セルについて、複数ブロックを <br> 区切りの 1 段落へまとめる（破壊的）。
 * 返り値はまとめ直したセルの数。
 */
export function mergeTableCellBlocks(doc: Document): number {
  let merged = 0;
  doc.querySelectorAll("td, th").forEach((cell) => {
    const children = Array.from(cell.childNodes).filter((n) => !isBlankText(n));
    const blocks = children.filter(isBlock);
    // ブロックが 2 つ未満、あるいはブロック以外の実体（直書きテキスト等）が混在する
    // セルは、そのまま ProseMirror に任せる。
    if (blocks.length < 2 || blocks.length !== children.length) return;

    const p = doc.createElement("p");
    blocks.forEach((block, i) => {
      if (i > 0) p.appendChild(doc.createElement("br"));
      while (block.firstChild) p.appendChild(block.firstChild);
    });
    cell.replaceChildren(p);
    merged++;
  });
  return merged;
}
