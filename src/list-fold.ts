import { Plugin, PluginKey } from "@milkdown/kit/prose/state";
import type { EditorState, Transaction } from "@milkdown/kit/prose/state";
import type { Node as ProseNode } from "@milkdown/kit/prose/model";
import { Decoration, DecorationSet } from "@milkdown/kit/prose/view";
import type { EditorView } from "@milkdown/kit/prose/view";

/**
 * 箇条書き・番号付きリストの折りたたみ（編集中の見た目のみ）。
 *
 * - 配下にネストしたリストを持つ list_item の左に三角アイコンを出し、
 *   クリックでその子リストを折りたたむ/展開する。
 * - 折りたたみ状態はプラグイン state（list_item の開始位置の配列）で保持し、
 *   編集による位置ズレには tr.mapping で追従する。保存 markdown には影響しない。
 *
 * 見出しの折りたたみ（heading-fold.ts）と同じ仕組みで、対象が list_item の点だけ異なる。
 */

interface FoldState {
  /** 折りたたみ中の list_item ノードの開始位置（ノードの直前位置）。 */
  collapsed: number[];
}

const foldKey = new PluginKey<FoldState>("list-fold");

function isListNode(name: string): boolean {
  return name === "bullet_list" || name === "ordered_list";
}

/** その list_item が（配下に）ネストしたリストを持つか。 */
function hasChildList(node: ProseNode): boolean {
  let found = false;
  node.forEach((child) => {
    if (isListNode(child.type.name)) found = true;
  });
  return found;
}

function toggleFold(view: EditorView, itemPos: number): void {
  view.dispatch(view.state.tr.setMeta(foldKey, { toggle: itemPos }));
}

/** リストの折りたたみをすべて解除する。 */
export function expandAllListFolds(view: EditorView): void {
  view.dispatch(view.state.tr.setMeta(foldKey, { clear: true }));
}

function makeToggle(
  view: EditorView,
  itemPos: number,
  collapsed: boolean,
): HTMLElement {
  const el = document.createElement("span");
  el.className = "list-fold-toggle" + (collapsed ? " is-collapsed" : "");
  el.setAttribute("contenteditable", "false");
  el.addEventListener("mousedown", (e) => {
    e.preventDefault();
    e.stopPropagation();
    toggleFold(view, itemPos);
  });
  return el;
}

function buildDecorations(
  state: EditorState,
  collapsed: number[],
): DecorationSet {
  const doc = state.doc;
  const collapsedSet = new Set(collapsed);
  const decos: Decoration[] = [];

  doc.descendants((node, pos) => {
    if (node.type.name !== "list_item") return true;
    if (!hasChildList(node)) return true;

    const isCollapsed = collapsedSet.has(pos);
    decos.push(
      Decoration.node(pos, pos + node.nodeSize, {
        class: isCollapsed ? "list-fold is-collapsed" : "list-fold",
      }),
    );
    decos.push(
      Decoration.widget(
        pos + 1,
        (view) => makeToggle(view, pos, isCollapsed),
        { side: -1, key: `lfold:${pos}:${isCollapsed}`, ignoreSelection: true },
      ),
    );

    if (isCollapsed) {
      // 子のネストリストだけを隠す（先頭の段落＝項目本文は残す）。
      node.forEach((child, offset) => {
        if (isListNode(child.type.name)) {
          const from = pos + 1 + offset;
          decos.push(
            Decoration.node(from, from + child.nodeSize, {
              class: "folded-hidden",
            }),
          );
        }
      });
    }
    return true;
  });

  return DecorationSet.create(doc, decos);
}

export const listFoldPlugin = new Plugin<FoldState>({
  key: foldKey,
  state: {
    init() {
      return { collapsed: [] };
    },
    apply(tr: Transaction, value: FoldState, _old, newState) {
      let collapsed = value.collapsed.map((pos) => tr.mapping.map(pos, -1));

      const meta = tr.getMeta(foldKey) as
        | { toggle?: number; clear?: boolean }
        | undefined;
      if (meta?.clear) {
        collapsed = [];
      } else if (meta && typeof meta.toggle === "number") {
        const target = meta.toggle;
        collapsed = collapsed.includes(target)
          ? collapsed.filter((p) => p !== target)
          : [...collapsed, target];
      }

      // list_item でなくなった / 子リストを失った位置は捨てる。重複も除去する。
      const seen = new Set<number>();
      collapsed = collapsed.filter((pos) => {
        if (seen.has(pos)) return false;
        seen.add(pos);
        const node = newState.doc.nodeAt(pos);
        return (
          node != null && node.type.name === "list_item" && hasChildList(node)
        );
      });

      return { collapsed };
    },
  },
  props: {
    decorations(state) {
      const fold = foldKey.getState(state);
      return buildDecorations(state, fold ? fold.collapsed : []);
    },
  },
});
