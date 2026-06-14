import { Plugin, PluginKey } from "@milkdown/kit/prose/state";
import type { EditorState, Transaction } from "@milkdown/kit/prose/state";
import { Decoration, DecorationSet } from "@milkdown/kit/prose/view";
import type { EditorView } from "@milkdown/kit/prose/view";

/**
 * 見出しの折りたたみ（編集中の見た目のみ）。
 *
 * - 各トップレベル見出しの左に三角アイコンを出し、クリックで配下を折りたたむ。
 * - 折りたたみ対象 = その見出しの「次の同レベル以上の見出し」までの全ブロック。
 *   レベルがより深い小見出しとその本文も範囲に含まれるため一緒に隠れる。
 * - 折りたたみ状態はプラグイン state（見出しの開始位置の配列）で保持し、
 *   編集による位置ズレには tr.mapping で追従する。保存 markdown には影響しない。
 *
 * 注: 引用やリスト内に入れ子になった見出しは対象外（トップレベル見出しのみ）。
 */

interface FoldState {
  /** 折りたたみ中の見出しノードの開始位置（ノードの直前位置）。 */
  collapsed: number[];
}

const foldKey = new PluginKey<FoldState>("heading-fold");

/** 指定見出しの折りたたみ状態をトグルするトランザクションを発行する。 */
function toggleFold(view: EditorView, headingPos: number): void {
  view.dispatch(view.state.tr.setMeta(foldKey, { toggle: headingPos }));
}

/** 見出しの折りたたみをすべて解除する。 */
export function expandAllHeadingFolds(view: EditorView): void {
  view.dispatch(view.state.tr.setMeta(foldKey, { clear: true }));
}

/** 三角アイコン（トグルボタン）の DOM を生成する。 */
function makeToggle(
  view: EditorView,
  headingPos: number,
  collapsed: boolean,
): HTMLElement {
  const el = document.createElement("span");
  el.className = "heading-fold-toggle" + (collapsed ? " is-collapsed" : "");
  el.setAttribute("contenteditable", "false");
  // PM 側の選択移動を避けつつ、自前でトグルする。
  el.addEventListener("mousedown", (e) => {
    e.preventDefault();
    e.stopPropagation();
    toggleFold(view, headingPos);
  });
  return el;
}

/** 現在の collapsed 集合から装飾（隠す範囲＋見出しのトグル）を組み立てる。 */
function buildDecorations(
  state: EditorState,
  collapsed: number[],
): DecorationSet {
  const doc = state.doc;
  const collapsedSet = new Set(collapsed);

  // トップレベルの子ノードを (node, offset) で列挙する。
  const tops: { type: string; level: number; from: number; to: number }[] = [];
  doc.forEach((node, offset) => {
    tops.push({
      type: node.type.name,
      level: node.type.name === "heading" ? Number(node.attrs.level) || 1 : 0,
      from: offset,
      to: offset + node.nodeSize,
    });
  });

  const decos: Decoration[] = [];

  for (let i = 0; i < tops.length; i++) {
    const cur = tops[i];
    if (cur.type !== "heading") continue;
    const isCollapsed = collapsedSet.has(cur.from);

    // 見出し自身にトグルアイコンを付与する。
    decos.push(
      Decoration.node(cur.from, cur.to, {
        class: isCollapsed ? "heading-fold is-collapsed" : "heading-fold",
      }),
    );
    decos.push(
      Decoration.widget(
        cur.from + 1,
        (view) => makeToggle(view, cur.from, isCollapsed),
        { side: -1, key: `fold:${cur.from}:${isCollapsed}`, ignoreSelection: true },
      ),
    );

    if (!isCollapsed) continue;

    // 次の「同レベル以上（level <= cur.level）」の見出しまでを隠す。
    for (let j = i + 1; j < tops.length; j++) {
      const sib = tops[j];
      if (sib.type === "heading" && sib.level <= cur.level) break;
      decos.push(Decoration.node(sib.from, sib.to, { class: "folded-hidden" }));
    }
  }

  return DecorationSet.create(doc, decos);
}

export const headingFoldPlugin = new Plugin<FoldState>({
  key: foldKey,
  state: {
    init() {
      return { collapsed: [] };
    },
    apply(tr: Transaction, value: FoldState, _old, newState) {
      // まず既存の折りたたみ位置を編集に追従させる。
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

      // 見出しでなくなった位置（削除・変形）は捨てる。重複も除去する。
      const seen = new Set<number>();
      collapsed = collapsed.filter((pos) => {
        if (seen.has(pos)) return false;
        seen.add(pos);
        const node = newState.doc.nodeAt(pos);
        return node != null && node.type.name === "heading";
      });

      return { collapsed };
    },
  },
  props: {
    decorations(state) {
      const fold = foldKey.getState(state);
      if (!fold || fold.collapsed.length === 0) {
        // 折りたたみが無くてもトグルアイコンは出したいので常に組み立てる。
        return buildDecorations(state, []);
      }
      return buildDecorations(state, fold.collapsed);
    },
  },
});
