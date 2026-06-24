/**
 * 検索マッチのハイライトを担う ProseMirror プラグイン。
 * find-replace コントローラが算出した doc 位置範囲を Decoration として描画する。
 * doc 変更時はデコレーションを map で追従させ、置換直後のズレを抑える。
 */
import { Plugin, PluginKey, TextSelection } from "@milkdown/kit/prose/state";
import type { EditorView } from "@milkdown/kit/prose/view";
import { Decoration, DecorationSet } from "@milkdown/kit/prose/view";

export type SearchRange = { from: number; to: number };

type SearchMeta = {
  ranges: SearchRange[];
  activeIndex: number;
};

type SearchState = {
  decorations: DecorationSet;
};

export const searchPluginKey = new PluginKey<SearchState>("md-editor-search");

function buildDecorations(
  doc: import("@milkdown/kit/prose/model").Node,
  ranges: SearchRange[],
  activeIndex: number,
): DecorationSet {
  if (ranges.length === 0) return DecorationSet.empty;
  const decos = ranges.map((r, i) =>
    Decoration.inline(r.from, r.to, {
      class: i === activeIndex ? "search-match search-match-active" : "search-match",
    }),
  );
  return DecorationSet.create(doc, decos);
}

export const searchPlugin = new Plugin<SearchState>({
  key: searchPluginKey,
  state: {
    init() {
      return { decorations: DecorationSet.empty };
    },
    apply(tr, value) {
      const meta = tr.getMeta(searchPluginKey) as SearchMeta | undefined;
      if (meta) {
        return {
          decorations: buildDecorations(tr.doc, meta.ranges, meta.activeIndex),
        };
      }
      // メタ更新がない doc 変更は既存デコレーションを写像して追従
      if (tr.docChanged) {
        return { decorations: value.decorations.map(tr.mapping, tr.doc) };
      }
      return value;
    },
  },
  props: {
    decorations(state) {
      return searchPluginKey.getState(state)?.decorations ?? null;
    },
  },
});

/** マッチ範囲とアクティブインデックスをプラグインに反映する。
 * scrollTo を渡すと、その範囲を選択し、マッチ位置を画面内へスクロールする。
 *
 * 注意: 検索バーの入力欄にフォーカスがある間は PM 標準の tr.scrollIntoView() が
 * 効かない（スクロール起点が編集領域外の DOM 選択になるため）。そこで outline.ts と
 * 同様に、マッチ位置の DOM 要素をネイティブ scrollIntoView で直接スクロールする。
 * 選択自体は設定しておくので、検索バーを閉じてエディタにフォーカスが戻った際にも
 * 正しい位置が表示される。 */
export function setSearchDecorations(
  view: EditorView,
  ranges: SearchRange[],
  activeIndex: number,
  scrollTo?: SearchRange | null,
): void {
  const meta: SearchMeta = { ranges, activeIndex };
  let tr = view.state.tr.setMeta(searchPluginKey, meta);
  let scrollFrom: number | null = null;
  if (scrollTo) {
    const size = view.state.doc.content.size;
    const from = Math.min(scrollTo.from, size);
    const to = Math.min(scrollTo.to, size);
    try {
      tr = tr.setSelection(TextSelection.create(tr.doc, from, to));
      scrollFrom = from;
    } catch (e) {
      // 選択不能な位置（atom ノード等）でも検索全体は継続させる
      console.warn("select match failed:", e);
    }
  }
  view.dispatch(tr);

  if (scrollFrom !== null) {
    try {
      const domAt = view.domAtPos(scrollFrom);
      let el: Node | null = domAt.node;
      if (el && el.nodeType === Node.TEXT_NODE) el = el.parentElement;
      if (el instanceof HTMLElement) {
        el.scrollIntoView({ block: "center", inline: "nearest" });
      }
    } catch (e) {
      console.warn("scroll to match failed:", e);
    }
  }
}

/** ハイライトをすべて解除する。 */
export function clearSearchDecorations(view: EditorView): void {
  setSearchDecorations(view, [], -1);
}
