/**
 * remark プラグイン: 脚注ノードをプレーンテキストへ展開する。
 *
 * remark(GFM) は [^1] / [^1]: … を footnoteReference / footnoteDefinition に
 * パースするが、エディタでは atom ノードになり1文字ずつ編集できない。
 * 本プラグインは mdast の段階でこれらを原文表記のテキスト/段落へ戻し、
 * エディタ内では脚注を常にテキストとして扱えるようにする（表示・ジャンプは
 * footnote-pair.ts のデコレーションが担う）。
 *
 * - footnoteReference → text "[^label]"
 * - footnoteDefinition → 先頭 "[^label]: " の paragraph。子の段落は break
 *   （エディタの hardbreak、保存時は単一 \n の怠惰継続）で結合する。
 *   段落以外の子ブロック（コードブロック等）は展開段落の直後に独立ブロック
 *   として並べる（保存すると定義外の内容になる既知の限界）。
 */

type MdastNode = {
  type: string;
  children?: MdastNode[];
  value?: string;
  label?: string | null;
  identifier?: string;
};

function labelOf(node: MdastNode): string {
  return node.label ?? node.identifier ?? "";
}

/** footnoteDefinition を「先頭 [^label]: の段落」＋残りブロック列へ展開する。 */
function defToBlocks(node: MdastNode): MdastNode[] {
  const inline: MdastNode[] = [
    { type: "text", value: `[^${labelOf(node)}]: ` },
  ];
  const rest: MdastNode[] = [];
  let paragraphsDone = false;
  for (const child of node.children ?? []) {
    if (child.type === "paragraph" && !paragraphsDone) {
      if (inline.length > 1) inline.push({ type: "break" });
      inline.push(...(child.children ?? []));
    } else {
      // 段落以外が出たら以降はすべて独立ブロック（元の順序を保つ）。
      paragraphsDone = true;
      rest.push(child);
    }
  }
  return [{ type: "paragraph", children: inline }, ...rest];
}

function transform(node: MdastNode): void {
  if (!Array.isArray(node.children)) return;
  const out: MdastNode[] = [];
  for (const child of node.children) {
    if (child.type === "footnoteReference") {
      out.push({ type: "text", value: `[^${labelOf(child)}]` });
      continue;
    }
    transform(child); // 定義内の参照も先に展開してから組み立てる
    if (child.type === "footnoteDefinition") {
      out.push(...defToBlocks(child));
    } else {
      out.push(child);
    }
  }
  node.children = out;
}

/** remark プラグイン本体。mdast ツリーを直接書き換える。 */
export function remarkFootnoteText() {
  return (tree: MdastNode): void => {
    transform(tree);
  };
}
