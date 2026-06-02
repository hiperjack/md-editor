/**
 * 検索マッチのハイライトを担う ProseMirror プラグイン。
 * find-replace コントローラが算出した doc 位置範囲を Decoration として描画する。
 * doc 変更時はデコレーションを map で追従させ、置換直後のズレを抑える。
 */
import { Plugin, PluginKey } from "@milkdown/kit/prose/state";
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

/** マッチ範囲とアクティブインデックスをプラグインに反映する。 */
export function setSearchDecorations(
  view: EditorView,
  ranges: SearchRange[],
  activeIndex: number,
): void {
  const meta: SearchMeta = { ranges, activeIndex };
  view.dispatch(view.state.tr.setMeta(searchPluginKey, meta));
}

/** ハイライトをすべて解除する。 */
export function clearSearchDecorations(view: EditorView): void {
  setSearchDecorations(view, [], -1);
}
