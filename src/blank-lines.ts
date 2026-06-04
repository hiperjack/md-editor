/**
 * 空行を「明示的な空段落ノード」として mdast に実体化する remark プラグイン。
 *
 * Milkdown / remark は通常、ブロック間の空行本数をパース時に捨てる
 * (連続する空行は 1 本へ畳まれ、位置情報のみ position に残る)。このため
 * 往復 (parse → serialize) で空行が失われ、行番号がソースと一致しなくなる。
 *
 * ここでは各ノードの position を見てブロック間 (と先頭) の空行本数を復元し、
 * その本数ぶん空 paragraph ノードを挿入する。シリアライズ側を「ブロック間は
 * 単一 \n 区切り (join=0)」にすることで、空段落 1 個 = 空行 1 行 として
 * 厳密に往復する。
 *
 * 対象は root と blockquote 直下のみ。リスト項目間の空行 (loose list) は
 * 現状スコープ外。
 */

type MdastNode = {
  type: string;
  children?: MdastNode[];
  position?: {
    start: { line: number };
    end: { line: number };
  };
};

const CONTAINER_TYPES = new Set(["root", "blockquote"]);

function makeBlankParagraph(): MdastNode {
  return { type: "paragraph", children: [] };
}

function materialize(node: MdastNode): void {
  if (!Array.isArray(node.children)) return;

  // 先に子コンテナ (blockquote 等) を処理する。先に親を書き換えると挿入済みの
  // 空段落 (position なし) が gap 計算に紛れ込むため、葉から戻る順で行う。
  for (const child of node.children) materialize(child);

  if (!CONTAINER_TYPES.has(node.type)) return;

  const kids = node.children;
  const out: MdastNode[] = [];

  // 先頭の空行 (root のみ): 最初のノードの開始行 - 1 が先頭空行数。
  if (node.type === "root" && kids.length > 0 && kids[0].position) {
    const lead = kids[0].position.start.line - 1;
    for (let i = 0; i < lead; i++) out.push(makeBlankParagraph());
  }

  for (let i = 0; i < kids.length; i++) {
    const cur = kids[i];
    const prev = i > 0 ? kids[i - 1] : null;
    if (prev?.position && cur.position) {
      const gap = cur.position.start.line - prev.position.end.line - 1;
      for (let g = 0; g < gap; g++) out.push(makeBlankParagraph());
    }
    out.push(cur);
  }

  node.children = out;
}

/** remark プラグイン本体。mdast ツリーを直接書き換える。 */
export function remarkBlankLines() {
  return (tree: MdastNode): void => {
    materialize(tree);
  };
}
