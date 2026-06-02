import { Crepe } from "@milkdown/crepe";
import type { Editor } from "@milkdown/kit/core";
import {
  commandsCtx,
  editorViewCtx,
  prosePluginsCtx,
  remarkPluginsCtx,
  remarkStringifyOptionsCtx,
} from "@milkdown/kit/core";
import { keymap } from "@milkdown/kit/prose/keymap";
import { Plugin } from "@milkdown/kit/prose/state";
import { GapCursor } from "@milkdown/kit/prose/gapcursor";
import { exitCode, lift } from "@milkdown/kit/prose/commands";
import type { EditorView } from "@milkdown/kit/prose/view";
import { insertHardbreakCommand } from "@milkdown/preset-commonmark";
import { keymap as cmKeymap } from "@codemirror/view";
import { Prec } from "@codemirror/state";
import remarkBreaks from "remark-breaks";
import "@milkdown/crepe/theme/common/style.css";
import "@milkdown/crepe/theme/frame-dark.css";

import { store, type Tab } from "./store";
import { attachLineNumbers } from "./line-numbers";
import { attachImageResolver } from "./image-resolver";
import { editImageNodeAtPos, isImageNode } from "./image-edit";
import { searchPlugin } from "./search-plugin";

/**
 * Smart Enter: Obsidian Live Preview に近い挙動にする。
 * - paragraph 内の Enter → hardbreak 挿入 (ソース上は1行追加)
 * - 直前が hardbreak なら paragraph 分割 (空行 + 新段落)
 * - list_item / code_block / heading / table 内はデフォルト挙動 (splitListItem 等)
 *
 * ProseMirror schema のノード名は preset-commonmark 準拠:
 *   - list_item, code_block (fence), heading, table*
 */
const SMART_ENTER_GUARD_NODES = new Set([
  "list_item",
  "code_block",
  "fence",
  "heading",
  "table",
  "table_row",
  "table_cell",
  "table_header",
]);

type EditorEntry = {
  tabId: string;
  container: HTMLElement;
  crepe: Crepe;
  /** 「未編集」の基準とするシリアライズ済みmarkdown */
  baseline: string;
  detachLineNumbers: () => void;
  detachImageResolver: () => void;
};

export type EditorHost = {
  /** タブを表示。エディタが未生成なら作成。他は隠す。 */
  show: (tab: Tab) => Promise<void>;
  /** タブを破棄（タブclose時のクリーンアップ）。 */
  destroy: (tabId: string) => Promise<void>;
  /** 現在のmarkdownを取得（保存用）。 */
  getMarkdown: (tabId: string) => string | null;
  /** baselineを現在のmarkdownにリセット（保存後）。 */
  resetBaseline: (tabId: string) => void;
  /** タブのエディタを作り直す（reload時）。 */
  recreate: (tab: Tab) => Promise<void>;
  /** アクティブタブのエディタにフォーカス。 */
  focus: () => void;
  /** アクティブタブのMilkdown Editorに対して操作を実行（toolbar/menu連携用）。 */
  runOnActive: (fn: (editor: Editor) => void) => void;
  /** アクティブタブの ProseMirror View を取得（検索/置換用）。無ければ null。 */
  getActiveView: () => EditorView | null;
};

export function createEditorHost(root: HTMLElement): EditorHost {
  const editors = new Map<string, EditorEntry>();
  const pendingEditors = new Map<string, Promise<EditorEntry>>();

  // 非アクティブなペインを退避させる隠しコンテナ。
  // 同じスクロールコンテナの兄弟として並べておくと、WebView2が複数の
  // 合成レイヤを抱え込んで残像を出すことが分かったため、DOMごと隔離する。
  let park = document.getElementById("editor-pane-park") as HTMLElement | null;
  if (!park) {
    park = document.createElement("div");
    park.id = "editor-pane-park";
    document.body.appendChild(park);
  }
  const parkEl = park;

  const hideAll = (exceptTabId: string | null) => {
    for (const [id, entry] of editors) {
      const isActive = id === exceptTabId;
      const targetParent = isActive ? root : parkEl;
      if (entry.container.parentElement !== targetParent) {
        targetParent.appendChild(entry.container);
      }
    }
  };

  const destroyEntry = async (entry: EditorEntry) => {
    entry.detachLineNumbers();
    entry.detachImageResolver();
    try {
      await entry.crepe.destroy();
    } catch (e) {
      console.warn("crepe.destroy failed:", e);
    }
    entry.container.remove();
  };

  const tabExists = (tabId: string) =>
    store.getState().tabs.some((tab) => tab.id === tabId);

  const getOrCreate = async (tab: Tab): Promise<EditorEntry> => {
    const existing = editors.get(tab.id);
    if (existing) return existing;

    let pending = pendingEditors.get(tab.id);
    if (!pending) {
      pending = make(tab)
        .then((entry) => {
          editors.set(tab.id, entry);
          return entry;
        })
        .finally(() => {
          pendingEditors.delete(tab.id);
        });
      pendingEditors.set(tab.id, pending);
    }

    return pending;
  };

  const focusActive = () => {
    const activeId = store.getActive()?.id ?? null;
    if (!activeId) return;
    const entry = editors.get(activeId);
    if (!entry) return;
    requestAnimationFrame(() => {
      const pm = entry.container.querySelector<HTMLElement>(".ProseMirror");
      pm?.focus();
    });
  };

  const make = async (tab: Tab): Promise<EditorEntry> => {
    const container = document.createElement("div");
    container.className = "editor-pane";
    container.dataset.tabId = tab.id;
    // park 側に先に置く。アクティブ化が必要なら呼び出し側がhideAll経由で
    // root に移動する。これで作成中の一瞬でも .editor-pane が #editor-host
    // 上に重ならない。
    parkEl.appendChild(container);

    // CodeMirror 内で Enter を 2 回連続押すとコードブロックから抜けて
     // 下に新しい段落を作る。1 回目はデフォルト (改行挿入)。
     // 検知: cursor が最終行の末尾、最終行が空、totalLines >= 2。
     let pmView: EditorView | null = null;
     // Prec.high で CM デフォルトの Enter (改行挿入) より先に呼ぶ
     const codeBlockExitKeymap = Prec.high(
       cmKeymap.of([
         {
           key: "Enter",
           run: (cm) => {
             const state = cm.state;
             const sel = state.selection.main;
             if (!sel.empty) return false;
             const head = sel.head;
             const lineAt = state.doc.lineAt(head);
             const totalLines = state.doc.lines;
             if (lineAt.number !== totalLines) return false;
             if (lineAt.text !== "") return false;
             if (totalLines < 2) return false;
             if (!pmView) return false;
             // 末尾の \n を消して、code block を抜ける
             cm.dispatch({
               changes: { from: head - 1, to: head, insert: "" },
             });
             const ok = exitCode(pmView.state, pmView.dispatch);
             if (ok) pmView.focus();
             return ok;
           },
         },
       ]),
     );

    const crepe = new Crepe({
      root: container,
      defaultValue: tab.diskContent,
      features: {
        [Crepe.Feature.BlockEdit]: false,
        [Crepe.Feature.Toolbar]: false,
      },
      featureConfigs: {
        [Crepe.Feature.CodeMirror]: {
          extensions: [codeBlockExitKeymap],
        },
      },
    });

    // Smart Enter: paragraph 内では Enter で hardbreak (1行改行)、
    // 直前が hardbreak なら paragraph 分割 (空行 + 新段落)。
    // list/code/heading/table は既定挙動を尊重。
    //
    // また、remark-breaks を組み込み、ソース markdown の単一 \n を hardbreak
    // として解釈する (Obsidian Live Preview 風: ソース1行=表示1行)。
    // remark-stringify の break ハンドラも上書きして、保存時 hardbreak を
    // 単一 \n で出力する (\\\n マーカーを排除して見た目をクリーンに)。
    /*
      コードブロック / テーブル等の block-only ノード同士の間 (margin gap)
      をクリックしたとき、その位置に空段落を作って選択可能にする。
      ProseMirror の標準 gapcursor は visualcursor が薄く、Crepe の
      virtual-cursor との相性で常時クリック検出されないため、ここで
      明示的に handleClick で gap → 空段落挿入を行う。
     */
    /*
      画像ノード (`image` / `image-block`) のダブルクリックで src/alt を編集する。
      Crepe のインライン画像は src 設定後はプレーンな <img> で表示されるだけなので
      競合する built-in ハンドラはない。dblclick は ProseMirror 経由で拾う。
    */
    const imageDoubleClickPlugin = new Plugin({
      props: {
        handleDoubleClickOn(view, _pos, node, nodePos) {
          if (!isImageNode(node)) return false;
          editImageNodeAtPos(view, nodePos, node);
          return true;
        },
      },
    });

    /*
      image-block の attrs.ratio を「ピクセル幅」として解釈する規約。
      - ratio > IMG_PX_THRESHOLD (10) → 画像をその px 幅で表示
      - ratio ≤ 10 → レガシー扱い（未設定 / 旧倍率）。natural fit のままにする
      この境界により ![](img.png) (alt 空 → ratio=1) は自動幅で表示される。
      Alt+ホイール拡縮や明示的な ![320](img.png) 指定で実際の px 幅に切り替わる。
    */
    const IMG_PX_THRESHOLD = 10;
    const IMG_PX_MIN = 50;
    const IMG_PX_MAX = 4000;

    /** image-block 配下の img 要素に対してピクセル幅を適用する。 */
    const applyPixelWidth = (img: HTMLImageElement, w: number) => {
      if (w > IMG_PX_THRESHOLD) {
        const want = `${w}px`;
        if (img.style.width !== want) img.style.width = want;
        if (img.style.height !== "auto") img.style.height = "auto";
      } else {
        // レガシー or 未設定: 我々の上書きを外し Crepe のレイアウトに任せる
        if (img.style.width) img.style.width = "";
      }
    };

    /*
      画像ブロック上で Alt+ホイールしたとき、ratio (= ピクセル幅) を増減する。
      初期値が小さい (レガシー) ときは現在のレンダリング幅を起点にする。
    */
    const imageWheelResizePlugin = new Plugin({
      props: {
        handleDOMEvents: {
          wheel(view, event) {
            if (!event.altKey) return false;
            const target = event.target as HTMLElement | null;
            if (!target) return false;
            const blockEl = target.closest(
              ".milkdown-image-block",
            ) as HTMLElement | null;
            if (!blockEl) return false;
            const coords = view.posAtCoords({
              left: event.clientX,
              top: event.clientY,
            });
            if (!coords || coords.inside < 0) return false;
            const node = view.state.doc.nodeAt(coords.inside);
            if (!node || node.type.name !== "image-block") return false;
            event.preventDefault();
            event.stopPropagation();

            const img = blockEl.querySelector(
              'img[data-type="image-block"]',
            ) as HTMLImageElement | null;

            const stored = Number(node.attrs.ratio) || 0;
            // 初回 (or レガシー) は現在の表示幅を基準に
            const baseline =
              stored > IMG_PX_THRESHOLD
                ? stored
                : Math.round(
                    img?.clientWidth || img?.naturalWidth || 320,
                  );
            const factor = event.deltaY < 0 ? 1.1 : 1 / 1.1;
            const next = Math.max(
              IMG_PX_MIN,
              Math.min(IMG_PX_MAX, Math.round(baseline * factor)),
            );
            if (next === stored) return true;

            // 視覚を即座に更新
            if (img) applyPixelWidth(img, next);

            view.dispatch(
              view.state.tr.setNodeMarkup(coords.inside, undefined, {
                ...node.attrs,
                ratio: next,
              }),
            );
            return true;
          },
        },
      },
    });

    /*
      image-block ノードの ratio (px 幅) を実 DOM の img に反映する Plugin。
      - view 初期化時 / 各 transaction で全 image-block を走査して幅を適用
      - Crepe の onImageLoad は <img> ロード後に style.height を上書きするので、
        load イベントでも再適用する
    */
    const imageBlockSizePlugin = new Plugin({
      view(editorView) {
        const apply = () => {
          editorView.state.doc.descendants((node, pos) => {
            if (node.type.name !== "image-block") return true;
            const dom = editorView.nodeDOM(pos);
            if (!(dom instanceof HTMLElement)) return true;
            const img = dom.querySelector(
              'img[data-type="image-block"]',
            ) as HTMLImageElement | null;
            if (!img) return true;
            applyPixelWidth(img, Number(node.attrs.ratio) || 0);
            return true;
          });
        };
        const HOOK_KEY = "__pxWidthLoadHooked";
        const hookImage = (img: HTMLImageElement) => {
          // biome-ignore lint: dynamic property as flag
          if ((img as unknown as Record<string, unknown>)[HOOK_KEY]) return;
          (img as unknown as Record<string, unknown>)[HOOK_KEY] = true;
          img.addEventListener("load", apply);
        };
        const scanAndHook = () => {
          editorView.dom
            .querySelectorAll<HTMLImageElement>(
              'img[data-type="image-block"]',
            )
            .forEach(hookImage);
        };
        scanAndHook();
        apply();

        const observer = new MutationObserver((muts) => {
          let needScan = false;
          for (const m of muts) {
            if (m.type === "childList") {
              needScan = true;
              break;
            }
          }
          if (needScan) {
            scanAndHook();
            apply();
          }
        });
        observer.observe(editorView.dom, {
          childList: true,
          subtree: true,
        });

        return {
          update: apply,
          destroy: () => observer.disconnect(),
        };
      },
    });

    const gapClickPlugin = new Plugin({
      props: {
        handleClick(view, pos, event) {
          // 空白エリアでクリックされた場合のみ動作
          // 1. クリック対象が ProseMirror 直下の "間" でないかチェック
          const target = event.target as HTMLElement;
          if (!target.classList.contains("ProseMirror")) return false;
          // 2. 親の前後の block を取得し、両者が空段落でない and pos が
          //    両者の境界にあるかどうか
          const $pos = view.state.doc.resolve(pos);
          // 親 doc レベルなら $pos.parent は doc。インデックスで前後 child を見る
          if ($pos.parent.type.name !== "doc") return false;
          const idx = $pos.index();
          const before = idx > 0 ? $pos.parent.child(idx - 1) : null;
          const after = idx < $pos.parent.childCount ? $pos.parent.child(idx) : null;
          // 隣接の少なくとも片方が text を直接受け付けない block (code, table,
          // hr) のときだけ空段落を差し込む。paragraph/heading 同士の間は
          // デフォルト挙動で十分 (隣接ブロックにフォーカスする)。
          const isBlockOnly = (n: typeof before) =>
            n != null &&
            (n.type.name === "code_block" ||
              n.type.name === "fence" ||
              n.type.name === "table" ||
              n.type.name === "horizontal_rule" ||
              n.type.name === "hr");
          if (!isBlockOnly(before) && !isBlockOnly(after)) {
            return false;
          }
          // GapCursor で空行に「カーソル位置だけ」を作る (空段落は挿入しない)。
          // ユーザーが文字入力した場合は ProseMirror が自動で paragraph を作る。
          const $pos2 = view.state.doc.resolve(pos);
          const tr = view.state.tr.setSelection(new GapCursor($pos2));
          view.dispatch(tr.scrollIntoView());
          return true;
        },
      },
    });

    crepe.editor.config((ctx) => {
      ctx.update(prosePluginsCtx, (plugins) => [
        searchPlugin,
        gapClickPlugin,
        imageDoubleClickPlugin,
        imageWheelResizePlugin,
        imageBlockSizePlugin,
        keymap({
          Enter: (state) => {
            // GapCursor (block 間のカーソル) では default 挙動 (paragraph 挿入)
            // に委譲する。ここで hardbreak を挿入すると不要な <br/> が混入する。
            if (state.selection instanceof GapCursor) return false;
            const { $from } = state.selection;
            for (let d = $from.depth; d > 0; d--) {
              const name = $from.node(d).type.name;
              if (SMART_ENTER_GUARD_NODES.has(name)) return false;
            }
            // 空段落での Enter は默認の splitBlock に委譲して、
            // 連続 Enter で末尾に空段落を追加できるようにする。
            // (insertHardbreakCommand は空段落 → hardbreak → 直前 hardbreak
            // 検出で paragraph 化、というループになり段落が増えない。)
            const parent = $from.parent;
            if (
              parent.type.name === "paragraph" &&
              parent.content.size === 0
            ) {
              return false;
            }
            const commands = ctx.get(commandsCtx);
            return commands.call(insertHardbreakCommand.key);
          },
          /*
            blockquote の先頭で Backspace を押したら引用を解除する。
            Markdown 編集の慣習に合わせ、空白行作成や 1文字削除より引用解除を優先。
            条件:
             - 選択が空 (キャレットのみ)
             - 親 paragraph の先頭 (parentOffset === 0)
             - 祖先に blockquote がある
            これらが揃ったときだけ ProseMirror 標準の lift を呼ぶ。
          */
          Backspace: (state, dispatch) => {
            const { selection } = state;
            if (!selection.empty) return false;
            const { $from } = selection;
            if ($from.parentOffset !== 0) return false;
            let inBlockquote = false;
            for (let d = $from.depth; d > 0; d--) {
              if ($from.node(d).type.name === "blockquote") {
                inBlockquote = true;
                break;
              }
            }
            if (!inBlockquote) return false;
            return lift(state, dispatch);
          },
        }),
        ...plugins,
      ]);
      ctx.update(remarkPluginsCtx, (plugins) => [
        ...plugins,
        { plugin: remarkBreaks, options: {} },
      ]);
      ctx.update(remarkStringifyOptionsCtx, (opts) => ({
        ...opts,
        // 箇条書きと水平線は `-` を使う (Marktext / Obsidian デフォルト)
        bullet: "-" as const,
        rule: "-" as const,
        handlers: {
          ...opts.handlers,
          // hardbreak は \\\n でなく単一 \n で出力
          break: () => "\n",
          /*
            画像の出力ハンドラ。
            image-block (= paragraph 内に image 単独で含まれるパターン) の
            alt はピクセル幅。`![320.00](img.png)` ではなく `![320](img.png)` と
            整数で出力する。インライン画像は alt をそのまま (ユーザー入力) 出す。
          */
          image: ((node: unknown, parent: unknown) => {
            const n = node as {
              url?: string;
              alt?: string | null;
              title?: string | null;
            };
            const p = parent as
              | { type?: string; children?: unknown[] }
              | null
              | undefined;
            const isBlockImage =
              !!p &&
              p.type === "paragraph" &&
              Array.isArray(p.children) &&
              p.children.length === 1 &&
              n.alt != null &&
              Number.isFinite(Number(n.alt));

            let altOut: string;
            if (isBlockImage) {
              const w = Math.round(Number(n.alt));
              // 閾値以下 (レガシー/未設定 ratio=1 等) は alt を空にして
              // クリーンな ![](url) に統一する。
              altOut = w > IMG_PX_THRESHOLD ? String(w) : "";
            } else {
              altOut = n.alt ?? "";
            }
            const safeAlt = altOut.replace(/]/g, "\\]");
            const url = n.url ?? "";
            const titlePart =
              n.title != null && n.title !== ""
                ? ` "${String(n.title).replace(/"/g, '\\"')}"`
                : "";
            return `![${safeAlt}](${url}${titlePart})`;
          }) as never,
        },
        // ブロック間の連結を制御 (Obsidian Live Preview 風)
        //   - hr / code block: 前後に空行 (1)
        //   - heading が片方: 空行なし (0)。連続見出しや見出し直後の本文を密に。
        //   - paragraph ↔ paragraph: 空行 (1) を維持。段落区切りの視認性。
        //   - その他: 空行なし (0)
        join: [
          (left, right) => {
            // 常に空行: hr (thematic break) の前後、table の前後、
            // 連続する code block 同士、blockquote の直後。
            // 段落間 (paragraph→paragraph) は空行で区切る。
            // それ以外 (heading↔他、paragraph→code 等) は隣接 (空行なし)。
            const types = [left.type, right.type];
            if (types.includes("thematicBreak")) return 1;
            if (types.includes("table")) return 1;
            if (left.type === "code" && right.type === "code") return 1;
            if (left.type === "blockquote") return 1;
            if (left.type === "paragraph" && right.type === "paragraph")
              return 1;
            return 0;
          },
          ...(opts.join ?? []),
        ],
      }));
    });

    await crepe.create();

    // CodeMirror keymap closure 用に PM view 参照を取得
    crepe.editor.action((ctx) => {
      pmView = ctx.get(editorViewCtx) as EditorView;
    });

    // 初期シリアライズ結果をbaselineとする（MarkText問題回避：
    //   生のファイル内容ではなくMilkdown正規化後の文字列を基準にする）
    const baseline = crepe.getMarkdown();

    const detachLineNumbers = attachLineNumbers(container, () =>
      crepe.getMarkdown(),
    );

    // 画像 src を md ファイル相対パスベースで Tauri asset URL に書き換える。
    // タブ毎に独立した container を観察し、現在の filePath を都度参照する。
    const detachImageResolver = attachImageResolver(
      container,
      () => store.getState().tabs.find((t) => t.id === tab.id)?.filePath ?? null,
    );

    const entry: EditorEntry = {
      tabId: tab.id,
      container,
      crepe,
      baseline,
      detachLineNumbers,
      detachImageResolver,
    };

    crepe.on((listener) => {
      listener.markdownUpdated((_ctx, markdown) => {
        const isDirty = markdown !== entry.baseline;
        store.setDirty(tab.id, isDirty);
      });
    });

    return entry;
  };

  return {
    async show(tab: Tab) {
      const entry = await getOrCreate(tab);

      if (!tabExists(tab.id)) {
        editors.delete(tab.id);
        await destroyEntry(entry);
        return;
      }

      const activeId = store.getActive()?.id ?? null;
      hideAll(activeId);
      if (activeId === tab.id) {
        focusActive();
      }
    },

    async destroy(tabId: string) {
      const pending = pendingEditors.get(tabId);
      if (pending) {
        const entry = await pending;
        editors.delete(tabId);
        await destroyEntry(entry);
        return;
      }

      const entry = editors.get(tabId);
      if (!entry) return;
      editors.delete(tabId);
      await destroyEntry(entry);
    },

    getMarkdown(tabId: string) {
      const entry = editors.get(tabId);
      if (!entry) return null;
      return entry.crepe.getMarkdown();
    },

    resetBaseline(tabId: string) {
      const entry = editors.get(tabId);
      if (!entry) return;
      entry.baseline = entry.crepe.getMarkdown();
    },

    async recreate(tab: Tab) {
      const pending = pendingEditors.get(tab.id);
      if (pending) {
        const entry = await pending;
        editors.delete(tab.id);
        await destroyEntry(entry);
      }

      const old = editors.get(tab.id);
      if (old) {
        editors.delete(tab.id);
        await destroyEntry(old);
      }
      const fresh = await make(tab);
      editors.set(tab.id, fresh);
      const activeId = store.getActive()?.id ?? null;
      if (activeId === tab.id) {
        hideAll(activeId);
        focusActive();
      } else {
        hideAll(activeId);
      }
    },

    focus: focusActive,

    runOnActive(fn) {
      const id = store.getActive()?.id;
      if (!id) return;
      const entry = editors.get(id);
      if (!entry) return;
      // Crepe.editor は内部のMilkdown Editorインスタンス
      try {
        fn(entry.crepe.editor);
        // コマンド実行後はエディタにフォーカスを戻す
        const pm = entry.container.querySelector<HTMLElement>(".ProseMirror");
        pm?.focus();
      } catch (e) {
        console.error("runOnActive failed:", e);
      }
    },

    getActiveView() {
      const id = store.getActive()?.id;
      if (!id) return null;
      const entry = editors.get(id);
      if (!entry) return null;
      let view: EditorView | null = null;
      try {
        entry.crepe.editor.action((ctx) => {
          view = ctx.get(editorViewCtx) as EditorView;
        });
      } catch (e) {
        console.warn("getActiveView failed:", e);
        return null;
      }
      return view;
    },
  };
}
