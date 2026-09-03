import { describe, it, expect } from "vitest";
import { Schema, type Node as ProseNode } from "@milkdown/kit/prose/model";
import { EditorState, TextSelection, type Transaction } from "@milkdown/kit/prose/state";
import { tableNodes } from "@milkdown/kit/prose/tables";
import { addRowOnTabAtLastCell } from "./table-tab";

// prosemirror-tables 標準の tableRole 付きスキーマ。判定ロジックは tableRole
// に基づくため、GFM プリセットのノード名（table_header_row 等）に依存しない。
const schema = new Schema({
  nodes: {
    doc: { content: "block+" },
    paragraph: { content: "inline*", group: "block" },
    text: { group: "inline" },
    ...tableNodes({ tableGroup: "block", cellContent: "paragraph+", cellAttributes: {} }),
  },
});

const p = (text?: string): ProseNode =>
  schema.nodes.paragraph.create(null, text ? schema.text(text) : undefined);
const cell = (...paras: ProseNode[]): ProseNode =>
  schema.nodes.table_cell.create(null, paras.length ? paras : [p()]);
const row = (...cells: ProseNode[]): ProseNode => schema.nodes.table_row.create(null, cells);

/** 2行×2列の表。セル文字列は "r0c0" 形式。 */
function makeDoc(): ProseNode {
  const table = schema.nodes.table.create(null, [
    row(cell(p("r0c0")), cell(p("r0c1"))),
    row(cell(p("r1c0")), cell(p("r1c1"))),
  ]);
  return schema.nodes.doc.create(null, [p("before"), table, p("after")]);
}

/** 文書中で text を含む最初のテキストノードの、その文字列の末尾位置。 */
function endOfText(doc: ProseNode, text: string): number {
  let found = -1;
  doc.descendants((node, pos) => {
    if (found >= 0) return false;
    if (node.isText && node.text === text) found = pos + text.length;
    return found < 0;
  });
  if (found < 0) throw new Error(`text not found: ${text}`);
  return found;
}

function stateAt(doc: ProseNode, pos: number): EditorState {
  return EditorState.create({
    doc,
    selection: TextSelection.create(doc, pos),
  });
}

function run(state: EditorState): { handled: boolean; state: EditorState } {
  let next = state;
  const dispatch = (tr: Transaction) => {
    next = state.apply(tr);
  };
  const handled = addRowOnTabAtLastCell(state, dispatch);
  return { handled, state: next };
}

function tableOf(doc: ProseNode): ProseNode {
  let table: ProseNode | null = null;
  doc.descendants((node) => {
    if (node.type.name === "table") table = node;
    return !table;
  });
  if (!table) throw new Error("table not found");
  return table;
}

describe("addRowOnTabAtLastCell", () => {
  it("最終セルの文末で Tab → 行を末尾に追加し、新行の先頭セルへキャレットを移す", () => {
    const doc = makeDoc();
    const { handled, state } = run(stateAt(doc, endOfText(doc, "r1c1")));
    expect(handled).toBe(true);
    const table = tableOf(state.doc);
    expect(table.childCount).toBe(3);
    // 新しい行は空セル2つ
    const newRow = table.child(2);
    expect(newRow.childCount).toBe(2);
    expect(newRow.textContent).toBe("");
    // キャレットは新行の先頭セル内
    const $head = state.selection.$head;
    expect(state.selection.empty).toBe(true);
    let inNewRow = false;
    for (let d = $head.depth; d > 0; d--) {
      if ($head.node(d) === newRow) inNewRow = true;
    }
    expect(inNewRow).toBe(true);
    expect($head.index($head.depth - 1)).toBe(0); // 先頭セル
  });

  it("最終セルでも文末でなければ何もしない（セル内 Tab 入力等に譲る）", () => {
    const doc = makeDoc();
    const { handled, state } = run(stateAt(doc, endOfText(doc, "r1c1") - 1));
    expect(handled).toBe(false);
    expect(tableOf(state.doc).childCount).toBe(2);
  });

  it("最終セル以外の文末では何もしない（次セル移動に譲る）", () => {
    const doc = makeDoc();
    const { handled } = run(stateAt(doc, endOfText(doc, "r1c0")));
    expect(handled).toBe(false);
    const { handled: h2 } = run(stateAt(doc, endOfText(doc, "r0c1")));
    expect(h2).toBe(false);
  });

  it("表の外では何もしない", () => {
    const doc = makeDoc();
    const { handled } = run(stateAt(doc, endOfText(doc, "after")));
    expect(handled).toBe(false);
  });

  it("範囲選択中は何もしない", () => {
    const doc = makeDoc();
    const end = endOfText(doc, "r1c1");
    const state = EditorState.create({
      doc,
      selection: TextSelection.create(doc, end - 2, end),
    });
    expect(run(state).handled).toBe(false);
  });

  it("セルに複数段落があるとき、最後の段落の末尾のみ文末とみなす", () => {
    const table = schema.nodes.table.create(null, [
      row(cell(p("a")), cell(p("b"))),
      row(cell(p("c")), cell(p("first"), p("last"))),
    ]);
    const doc = schema.nodes.doc.create(null, [table]);
    expect(run(stateAt(doc, endOfText(doc, "first"))).handled).toBe(false);
    expect(run(stateAt(doc, endOfText(doc, "last"))).handled).toBe(true);
  });
});
