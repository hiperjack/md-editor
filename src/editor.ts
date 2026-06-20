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
import { Plugin, TextSelection } from "@milkdown/kit/prose/state";
import type { Node as ProseNode } from "@milkdown/kit/prose/model";
import { GapCursor } from "@milkdown/kit/prose/gapcursor";
import { exitCode, joinBackward, lift } from "@milkdown/kit/prose/commands";
import type { EditorView } from "@milkdown/kit/prose/view";
import {
  insertHardbreakCommand,
  remarkPreserveEmptyLinePlugin,
} from "@milkdown/preset-commonmark";
import { keymap as cmKeymap } from "@codemirror/view";
import { Prec } from "@codemirror/state";
import {
  LanguageDescription,
  LanguageSupport,
  StreamLanguage,
} from "@codemirror/language";
import { languages as codeLanguages } from "@codemirror/language-data";
import remarkBreaks from "remark-breaks";
import "@milkdown/crepe/theme/common/style.css";
import "@milkdown/crepe/theme/frame-dark.css";

import { store, type Tab } from "./store";
import { remarkBlankLines } from "./blank-lines";
import { attachLineNumbers } from "./line-numbers";
import { attachImageResolver, imageDirForMdPath } from "./image-resolver";
import { persistEmbeddedImages, type PersistResult } from "./image-persist";
import { editImageNodeAtPos, isImageNode } from "./image-edit";
import { searchPlugin } from "./search-plugin";
import { headingFoldPlugin } from "./heading-fold";
import { listFoldPlugin } from "./list-fold";
import { fileTypeOfPath, wrapMermaidSource } from "./mmd";
import { mermaidCodePreview } from "./mermaid-renderer";
import { docTheme } from "./theme";
import { ensureDocumentStyles, setHljsThemeStyle } from "./doc-styles";
import { t } from "./i18n";
import { replaceAll } from "@milkdown/kit/utils";
import { createSourcePane, type SourcePane } from "./source-mode";
import { formatImageAlt } from "./image-row";

// コードブロックの「プレビューのみ(隠す)」状態を出現順で取得する。
// .cm-editor が非表示(offsetParent===null)＝「隠す」状態とみなす。
function captureCodeBlockHidden(container: HTMLElement): boolean[] {
  const blocks = container.querySelectorAll<HTMLElement>(".milkdown-code-block");
  return Array.from(blocks).map((block) => {
    const cm = block.querySelector<HTMLElement>(".cm-editor");
    return !!cm && cm.offsetParent === null;
  });
}

// Mermaidコードブロックを既定で「隠す」（プレビューのみ）状態にする。
// プレビュー(＝トグルボタン)の出現を待ってからトグルする。
function autoCollapseMermaidBlocks(container: HTMLElement): void {
  let tries = 0;
  const collapsed = new WeakSet<Element>();
  const apply = () => {
    const blocks = Array.from(
      container.querySelectorAll<HTMLElement>(".milkdown-code-block"),
    );
    let anyPending = false;
    for (const block of blocks) {
      const lang = block
        .querySelector<HTMLElement>(".language-button")
        ?.textContent?.trim()
        .toLowerCase();
      if (lang !== "mermaid") continue;
      if (collapsed.has(block)) continue;
      const cm = block.querySelector<HTMLElement>(".cm-editor");
      const toggle = block.querySelector<HTMLElement>(".preview-toggle-button");
      // トグルボタンはプレビュー描画後に出る。出るまで待つ。
      if (!toggle || !cm) {
        anyPending = true;
        continue;
      }
      if (cm.offsetParent !== null) toggle.click(); // 表示中→隠す
      collapsed.add(block);
    }
    // 図のプレビュー描画(デバウンス~800ms)を待つため一定回数まで再試行する。
    if (anyPending && tries < 150) {
      tries++;
      requestAnimationFrame(apply);
    }
  };
  requestAnimationFrame(apply);
}

// 作り直し後のコードブロックに「隠す」状態を復元する（出現順で対応）。
// ブロックのレンダリングを待ってからトグルボタンを押す。
function restoreCodeBlockHidden(container: HTMLElement, states: boolean[]): void {
  if (!states.some(Boolean)) return;
  let tries = 0;
  const apply = () => {
    const blocks = Array.from(
      container.querySelectorAll<HTMLElement>(".milkdown-code-block"),
    );
    if (blocks.length < states.length && tries < 60) {
      tries++;
      requestAnimationFrame(apply);
      return;
    }
    blocks.forEach((block, i) => {
      if (!states[i]) return;
      const cm = block.querySelector<HTMLElement>(".cm-editor");
      const toggle = block.querySelector<HTMLElement>(".preview-toggle-button");
      if (cm && cm.offsetParent !== null && toggle) toggle.click();
    });
  };
  requestAnimationFrame(apply);
}

// クリックされた .milkdown-code-block の DOM から、対応する code_block ノードの
// ドキュメント位置を求める。見つからなければ null。
function findCodeBlockPos(view: EditorView, blockEl: HTMLElement): number | null {
  let found: number | null = null;
  view.state.doc.descendants((node, pos) => {
    if (found !== null) return false;
    if (node.type.name !== "code_block") return true;
    const dom = view.nodeDOM(pos);
    if (
      dom === blockEl ||
      (dom instanceof Node && blockEl.contains(dom)) ||
      (dom instanceof Node && dom.contains(blockEl))
    ) {
      found = pos;
      return false;
    }
    return true;
  });
  return found;
}

// code_block を解除し、中身を通常段落へ戻す。
// 行区切りは hardbreak（このエディタの「1行=hardbreak」方針）で保持する。
function unwrapCodeBlockAt(view: EditorView, pos: number): void {
  const node = view.state.doc.nodeAt(pos);
  if (!node || node.type.name !== "code_block") return;
  const schema = view.state.schema;
  const paragraphType = schema.nodes.paragraph;
  const hardbreakType = schema.nodes.hardbreak;
  if (!paragraphType) return;

  const lines = node.textContent.split("\n");
  const inline: ProseNode[] = [];
  lines.forEach((line, i) => {
    if (i > 0 && hardbreakType) inline.push(hardbreakType.create());
    if (line.length > 0) inline.push(schema.text(line));
  });
  const paragraph = paragraphType.create(null, inline);

  const tr = view.state.tr.replaceWith(pos, pos + node.nodeSize, paragraph);
  // 解除後の段落先頭へキャレットを置く
  const sel = TextSelection.create(tr.doc, pos + 1);
  view.dispatch(tr.setSelection(sel).scrollIntoView());
  view.focus();
}

// 1ブロック分のインライン内容を「コードとしてのプレーンテキスト」に変換する。
// hardbreak は改行に、テキストはそのまま連結する。
function blockTextWithBreaks(node: ProseNode): string {
  let out = "";
  node.forEach((child) => {
    if (child.isText) out += child.text ?? "";
    else if (child.type.name === "hardbreak") out += "\n";
    else out += child.textContent;
  });
  return out;
}

/**
 * 選択範囲を1つの code_block に変換する。
 * Milkdown 既定の createCodeBlockCommand（= setBlockType）は code_block が
 * 許可しない hardbreak ノードを変換時に捨てるため、改行が潰れて1行になる。
 * ここでは範囲内の各ブロックのテキストを hardbreak→改行・ブロック境界→改行で
 * 連結し、改行を保持したまま単一のコードブロックを作る（解除→再ブロック化の
 * 往復が成立する）。
 */
export function createCodeBlockFromSelection(view: EditorView): boolean {
  const { state } = view;
  const schema = state.schema;
  const codeBlockType = schema.nodes.code_block;
  if (!codeBlockType) return false;

  const { $from, $to } = state.selection;
  const range = $from.blockRange($to);
  if (!range) return false;
  const { parent, startIndex, endIndex, start, end } = range;

  const parts: string[] = [];
  for (let i = startIndex; i < endIndex; i++) {
    parts.push(blockTextWithBreaks(parent.child(i)));
  }
  const text = parts.join("\n");

  const codeBlock = codeBlockType.create(
    { language: "" },
    text.length > 0 ? schema.text(text) : null,
  );
  const tr = state.tr.replaceWith(start, end, codeBlock);
  // カーソルをコードブロック内の先頭へ
  const sel = TextSelection.create(tr.doc, start + 1);
  view.dispatch(tr.setSelection(sel).scrollIntoView());
  view.focus();
  return true;
}

/** ハイライトなしのプレーンテキスト言語を作る（言語ピッカー登録用）。 */
function plainTextLanguage(
  name: string,
  alias: string[],
  extensions: string[],
): LanguageDescription {
  return LanguageDescription.of({
    name,
    alias,
    extensions,
    load: async () =>
      new LanguageSupport(
        StreamLanguage.define({
          token: (stream) => {
            stream.skipToEnd();
            return null;
          },
        }),
      ),
  });
}

/**
 * コードブロックの言語ピッカーに出す言語一覧。
 * CodeMirror公式の言語定義（@codemirror/language-data）には mermaid と
 * プレーンテキストが存在しないため、ここで追加する（名前順の位置に挿入）。
 * mermaid のプレビュー描画は renderPreview 側が言語名で判定する。
 */
const codeBlockLanguages: LanguageDescription[] = (() => {
  const list = [...codeLanguages];
  for (const lang of [
    // mermaid はフェンス互換性（GitHub等は小文字のみ図として描画）のため小文字
    plainTextLanguage("mermaid", ["mmd"], ["mmd", "mermaid"]),
    plainTextLanguage("Text", ["text", "plaintext", "txt", "plain"], ["txt"]),
  ]) {
    const idx = list.findIndex(
      (l) => l.name.toLowerCase() > lang.name.toLowerCase(),
    );
    list.splice(idx < 0 ? list.length : idx, 0, lang);
  }
  return list;
})();

type EditorEntry = {
  tabId: string;
  container: HTMLElement;
  /** preview タブは Crepe を持たない（読み取り専用のHTML表示）。 */
  crepe: Crepe | null;
  /** 「未編集」の基準とするシリアライズ済みmarkdown */
  baseline: string;
  detachLineNumbers: () => void;
  detachImageResolver: () => void;
  /** ソースモード中か。 */
  sourceMode: boolean;
  /** ソースモード中の CodeMirror ペイン。非ソース時は null。 */
  sourcePane: SourcePane | null;
};

export type EditorHost = {
  /** タブを表示。エディタが未生成なら作成。他は隠す。 */
  show: (tab: Tab) => Promise<void>;
  /** タブを破棄（タブclose時のクリーンアップ）。 */
  destroy: (tabId: string) => Promise<void>;
  /** 現在のmarkdownを取得（保存用）。 */
  getMarkdown: (tabId: string) => string | null;
  /** baseline（正規化済みディスク内容）を取得（移送時の dirty 引き継ぎ用）。 */
  getBaseline: (tabId: string) => string | null;
  /** baselineを現在のmarkdownにリセット（保存後）。 */
  resetBaseline: (tabId: string) => void;
  /** タブのエディタを作り直す（reload時）。 */
  recreate: (
    tab: Tab,
    opts?: {
      noFocus?: boolean;
      preserveScroll?: number;
      preserveCodeBlockState?: boolean;
    },
  ) => Promise<void>;
  /**
   * Mermaidを含む全タブを、未保存内容を保ったまま作り直す。
   * 配色変更を確実に反映するため（Crepe管理下のプレビューDOM直接書き換えは
   * Vueの再描画で戻されるため、作り直し＝開き直しと同等の経路を使う）。
   */
  recreateMermaidTabs: () => Promise<void>;
  /** プレビュータブを現在のストア内容で再描画する。スクロール位置とズーム倍率を保持する。 */
  refreshPreviewPane: (tabId: string) => Promise<void>;
  /** アクティブタブのエディタにフォーカス。 */
  focus: () => void;
  /** アクティブタブのMilkdown Editorに対して操作を実行（toolbar/menu連携用）。 */
  runOnActive: (fn: (editor: Editor) => void) => void;
  /** アクティブタブの ProseMirror View を取得（検索/置換用）。無ければ null。 */
  getActiveView: () => EditorView | null;
  /** タブ内の貼り付け画像(data:/blob:)を <mdDir>/img/<md名>/ へ書き出し、参照をベアファイル名へ書換える。 */
  persistImages: (tabId: string, mdFilePath: string) => Promise<PersistResult>;
  /** いずれかのタブの内容が変わったら通知（アウトライン等の再構築用）。 */
  onContentChange: (fn: (tabId: string) => void) => () => void;
  /** 指定タブの WYSIWYG ⇄ ソース編集 をトグルする（preview タブでは無効）。 */
  toggleSourceMode: (tabId: string) => void;
  /** 指定タブが現在ソースモードかを返す。 */
  isSourceMode: (tabId: string) => boolean;
};

export function createEditorHost(root: HTMLElement): EditorHost {
  const editors = new Map<string, EditorEntry>();
  const pendingEditors = new Map<string, Promise<EditorEntry>>();
  const contentListeners = new Set<(tabId: string) => void>();

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
    if (entry.sourcePane) {
      entry.sourcePane.destroy();
      entry.sourcePane = null;
    }
    entry.detachLineNumbers();
    entry.detachImageResolver();
    if (entry.crepe) {
      try {
        await entry.crepe.destroy();
      } catch (e) {
        console.warn("crepe.destroy failed:", e);
      }
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
      pending = make(tab, { autoCollapse: true })
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
    if (entry.sourceMode && entry.sourcePane) {
      const pane = entry.sourcePane;
      requestAnimationFrame(() => pane.focus());
      return;
    }
    requestAnimationFrame(() => {
      const pm = entry.container.querySelector<HTMLElement>(".ProseMirror");
      // フォーカス時の自動スクロール（キャレット=先頭へ飛ぶ）を抑止する。
      // メニュー経由で設定を開く際に編集中位置が先頭へ飛ぶのを防ぐ。
      pm?.focus({ preventScroll: true });
    });
  };

  // 読み取り専用のHTMLプレビュータブ。Crepeを使わず、レンダリング済みHTMLを表示する。
  const makePreview = (tab: Tab): EditorEntry => {
    const container = document.createElement("div");
    container.className = "editor-pane preview-pane";
    container.dataset.tabId = tab.id;
    if (tab.previewMode === "htmlfile") {
      // 外部HTMLファイルはサンドボックスiframeで隔離表示（スクリプト無効・スタイル非干渉）。
      const iframe = document.createElement("iframe");
      iframe.className = "preview-iframe";
      // allow-* を一切付けない sandbox によりスクリプト等を無効化する。
      iframe.setAttribute("sandbox", "");
      iframe.srcdoc = tab.previewSrcDoc ?? "";
      container.appendChild(iframe);
    } else {
      // プレビューの .document が参照する文書CSS・ハイライトCSSを、このウィンドウへ
      // 確実に注入する（別ウィンドウへ移送された場合に背景等が欠落するのを防ぐ）。
      // ensureDocumentStyles は冪等。
      ensureDocumentStyles();
      setHljsThemeStyle(docTheme.get().theme.highlightTheme);
      container.innerHTML = tab.previewHtml ?? "";
    }
    parkEl.appendChild(container);
    return {
      tabId: tab.id,
      container,
      crepe: null,
      baseline: "",
      detachLineNumbers: () => {},
      detachImageResolver: () => {},
      sourceMode: false,
      sourcePane: null,
    };
  };

  const make = async (
    tab: Tab,
    opts?: { autoCollapse?: boolean },
  ): Promise<EditorEntry> => {
    if (tab.kind === "preview") return makePreview(tab);

    // 移送（新規ウィンドウ化）タブは、表示内容と baseline を引き継ぐ。
    // 通常タブでは undefined。
    const override = store.takeInitialOverride(tab.id);

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

    // .mmd（Mermaid単体ファイル）は、全体を1つの ```mermaid フェンスにラップして
    // 編集する。保存時に actions.ts がアンラップする。移送タブ（override）は
    // ラップ済みのmarkdownを引き継いでいるので再ラップしない。
    const initialValue =
      override?.content ??
      (fileTypeOfPath(tab.filePath) === "mmd"
        ? wrapMermaidSource(tab.diskContent)
        : tab.diskContent);

    const crepe = new Crepe({
      root: container,
      defaultValue: initialValue,
      features: {
        [Crepe.Feature.BlockEdit]: false,
        [Crepe.Feature.Toolbar]: false,
      },
      featureConfigs: {
        [Crepe.Feature.CodeMirror]: {
          extensions: [codeBlockExitKeymap],
          languages: codeBlockLanguages,
          // ```mermaid ブロックの直下に図のライブプレビューを表示する。
          // 描画はデバウンス＋キャッシュ付き（mermaid-renderer.ts）。
          renderPreview: (language, content, applyPreview) => {
            if (language.toLowerCase() !== "mermaid") return null;
            return mermaidCodePreview(content, applyPreview);
          },
          previewLabel: t("cb.previewLabel"),
          previewLoading: t("cb.previewLoading"),
          previewToggleText: (previewOnlyMode) =>
            previewOnlyMode ? t("cb.previewEdit") : t("cb.previewHide"),
        },
      },
    });

    // Enter は既定の段落分割 (一般的なエディタ挙動)。同じ段落内のソフト改行は
    // Shift+Enter (hardbreak)。キーマップは後段の keymap({...}) で定義する。
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

    /*
      コードブロック右上のツールバー（.tools-button-group: コピーボタン等が並ぶ）に
      「解除」ボタンを差し込み、押下でそのコードブロックを通常テキストへ戻す。
      ツールバーは Crepe の Vue コンポーネントが管理するため、再描画で消えても
      MutationObserver で再注入する（既存の画像プラグインと同じ手法）。
    */
    const codeBlockUnwrapPlugin = new Plugin({
      view(editorView) {
        const BTN_CLASS = "cb-unwrap-button";
        const inject = () => {
          editorView.dom
            .querySelectorAll<HTMLElement>(".milkdown-code-block")
            .forEach((block) => {
              const group =
                block.querySelector<HTMLElement>(".tools .tools-button-group") ??
                block.querySelector<HTMLElement>(".tools");
              if (!group || group.querySelector(`.${BTN_CLASS}`)) return;
              const btn = document.createElement("button");
              btn.type = "button";
              btn.className = BTN_CLASS;
              btn.textContent = t("cb.unwrap");
              btn.title = t("cb.unwrapTitle");
              // PM 側の選択変更/blur を避けるため mousedown を握りつぶす
              btn.addEventListener("mousedown", (e) => e.preventDefault());
              btn.addEventListener("click", (e) => {
                e.preventDefault();
                e.stopPropagation();
                const pos = findCodeBlockPos(editorView, block);
                if (pos != null) unwrapCodeBlockAt(editorView, pos);
              });
              group.appendChild(btn);
            });
        };
        inject();
        const observer = new MutationObserver(() => inject());
        observer.observe(editorView.dom, { childList: true, subtree: true });
        return { destroy: () => observer.disconnect() };
      },
    });

    crepe.editor.config((ctx) => {
      ctx.update(prosePluginsCtx, (plugins) => [
        searchPlugin,
        headingFoldPlugin,
        listFoldPlugin,
        gapClickPlugin,
        codeBlockUnwrapPlugin,
        imageDoubleClickPlugin,
        imageWheelResizePlugin,
        imageBlockSizePlugin,
        keymap({
          /*
            Enter は既定の段落分割 / リスト分割に委ねる (一般的なエディタ挙動)。
            同じ段落内のソフト改行 (hardbreak) は Shift+Enter に割り当てる。
            外部ファイル読込時の remark-breaks (単一 \n → hardbreak) は互換のため残す。
          */
          "Shift-Enter": () => {
            const commands = ctx.get(commandsCtx);
            return commands.call(insertHardbreakCommand.key);
          },
          /*
            行頭 (キャレットのみ・parentOffset === 0) での Backspace の挙動を、
            祖先ノードに応じて分岐させる。
             - blockquote 先頭 → 引用解除 (lift)。Markdown 編集の慣習に合わせる。
             - list_item 先頭 → Crepe 既定の「リスト解除」ではなく、標準の前方結合
               (joinBackward: 直前の行/項目と結合) を行う。先頭にこれ以上前が無く
               joinBackward が失敗する場合のみ、既定 (リスト解除) にフォールバックする。
          */
          Backspace: (state, dispatch) => {
            const { selection } = state;
            if (!selection.empty) return false;
            const { $from } = selection;
            if ($from.parentOffset !== 0) return false;
            let inBlockquote = false;
            let inListItem = false;
            for (let d = $from.depth; d > 0; d--) {
              const name = $from.node(d).type.name;
              if (name === "blockquote") inBlockquote = true;
              if (name === "list_item") inListItem = true;
            }
            if (inListItem) return joinBackward(state, dispatch);
            if (inBlockquote) return lift(state, dispatch);
            return false;
          },
        }),
        ...plugins,
      ]);
      ctx.update(remarkPluginsCtx, (plugins) => [
        ...plugins,
        { plugin: remarkBreaks, options: {} },
        // 空行を空段落ノードへ実体化し、往復で空行を保持する。
        // remarkBreaks の後に置く (ブロック間 position は影響を受けない)。
        { plugin: remarkBlankLines, options: {} },
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
            テキストノードのエスケープ抑止。
            remark-stringify は既定で markdown 特殊文字をエスケープし、
            `[`→`\[`、`]`→`\]`、`_`→`\_` になる。これにより
            ウィキリンク `[[FY26_AIマネタイズ_…]]` が壊れて保存されるため、
            既定の safe 処理後にこれらのエスケープのみ元へ戻す。
            text ハンドラを通らない code / inlineCode (verbatim) には影響しない。
          */
          text: ((node: unknown, _parent: unknown, state: unknown, info: unknown) => {
            const n = node as { value?: string };
            const s = state as {
              safe: (value: string, info: unknown) => string;
            };
            const value = s.safe(n.value ?? "", info);
            return value.replace(/\\([[\]_])/g, "$1");
          }) as never,
          /*
            画像の出力ハンドラ。
            数値 alt は px 幅、その他はそのまま（インライン/ブロック共通規約）。
            formatImageAlt が閾値判定・整数変換を行う。
          */
          image: ((node: unknown) => {
            const n = node as {
              url?: string;
              alt?: string | null;
              title?: string | null;
            };
            // 数値 alt は px 幅、その他はそのまま（インライン/ブロック共通規約）
            const safeAlt = formatImageAlt(n.alt).replace(/]/g, "\\]");
            const url = n.url ?? "";
            const titlePart =
              n.title != null && n.title !== ""
                ? ` "${String(n.title).replace(/"/g, '\\"')}"`
                : "";
            return `![${safeAlt}](${url}${titlePart})`;
          }) as never,
        },
        /*
          ブロック間は原則「単一 \n 区切り (空行 0)」にする。
          空行は remarkBlankLines が空段落ノードとして実体化しているため、
          空行本数は空段落の個数で決まり、join 側で自動挿入しない。これで
          ソース markdown と保存結果が空行まで含めて 1:1 で往復する。

          保険として、間に空段落が無く直接隣接する危険な組み合わせ
          (連続 code block 同士、table↔table) のみ空行 (1) を強制し、
          再パースでの取り違えを防ぐ。正常な markdown はこれらの周囲に
          空行を持ち空段落として実体化されるため、通常は 0 で足りる。
        */
        join: [
          (left, right) => {
            if (left.type === "code" && right.type === "code") return 1;
            if (left.type === "table" && right.type === "table") return 1;
            return 0;
          },
        ],
      }));
    });

    await crepe.create();

    // Milkdown 既定の「空行保持」プラグインを外す。
    // これを有効のままにすると、空段落 (= 空行) が保存時に `<br />` という
    // リテラル HTML として出力されてしまう (preset-commonmark の paragraph
    // シリアライザが shouldPreserveEmptyLine 時に <br /> を挿入するため)。
    // 外すと空段落は空文字ブロックとしてシリアライズされ、join=0 と相まって
    // 「空段落 1 個 = 空行 1 行」でソースと厳密に往復する。空行の実体化は
    // remarkBlankLines が担う。
    await crepe.editor.remove(remarkPreserveEmptyLinePlugin);

    // CodeMirror keymap closure 用に PM view 参照を取得
    crepe.editor.action((ctx) => {
      pmView = ctx.get(editorViewCtx) as EditorView;
    });

    // 初期シリアライズ結果をbaselineとする（MarkText問題回避：
    //   生のファイル内容ではなくMilkdown正規化後の文字列を基準にする）。
    // 移送タブは移送元の baseline を引き継ぎ、未保存状態を保持する。
    const baseline = override?.baseline ?? crepe.getMarkdown();

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
      sourceMode: false,
      sourcePane: null,
    };

    crepe.on((listener) => {
      listener.markdownUpdated((_ctx, markdown) => {
        const isDirty = markdown !== entry.baseline;
        store.setDirty(tab.id, isDirty);
        for (const fn of contentListeners) fn(tab.id);
      });
    });

    // 移送タブで content が baseline と異なる（＝未保存だった）場合、
    // markdownUpdated は編集まで発火しないので初期 dirty をここで反映する。
    if (override && crepe.getMarkdown() !== baseline) {
      store.setDirty(tab.id, true);
    }

    // Mermaidコードブロックを既定で隠す設定なら、初回生成時に折りたたむ。
    if (opts?.autoCollapse && docTheme.get().theme.mermaidCollapsed) {
      autoCollapseMermaidBlocks(container);
    }

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
      if (entry.sourceMode && entry.sourcePane) {
        return entry.sourcePane.getText();
      }
      if (!entry.crepe) return null;
      return entry.crepe.getMarkdown();
    },

    getBaseline(tabId: string) {
      const entry = editors.get(tabId);
      if (!entry) return null;
      return entry.baseline;
    },

    resetBaseline(tabId: string) {
      const entry = editors.get(tabId);
      if (!entry) return;
      if (entry.sourceMode && entry.sourcePane) {
        entry.baseline = entry.sourcePane.getText();
        return;
      }
      if (!entry.crepe) return;
      entry.baseline = entry.crepe.getMarkdown();
    },

    async recreate(
      tab: Tab,
      opts?: {
        noFocus?: boolean;
        preserveScroll?: number;
        preserveCodeBlockState?: boolean;
      },
    ) {
      // 作り直し前のコードブロックの「隠す」状態を控える（復元用）
      const hiddenStates = opts?.preserveCodeBlockState
        ? captureCodeBlockHidden(
            editors.get(tab.id)?.container ?? document.createElement("div"),
          )
        : null;
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
      hideAll(activeId);
      if (activeId === tab.id) {
        // 配色変更での作り直しは noFocus 指定。フォーカス移動はカーソル(先頭)へ
        // スクロールさせ、位置が先頭に飛ぶ原因になるため避ける。
        if (!opts?.noFocus) focusActive();
        // コードブロックの「隠す」状態を復元する。
        if (hiddenStates) restoreCodeBlockHidden(fresh.container, hiddenStates);
        // 作り直しで失われるスクロール位置を、高さ確定まで再試行して復元する。
        if (opts?.preserveScroll != null && opts.preserveScroll > 0) {
          const c = fresh.container;
          const target = opts.preserveScroll;
          let count = 0;
          const restore = () => {
            c.scrollTop = target;
            if (++count < 180 && Math.abs(c.scrollTop - target) > 2) {
              requestAnimationFrame(restore);
            }
          };
          requestAnimationFrame(restore);
        }
      }
    },

    async recreateMermaidTabs() {
      const activeId = store.getActive()?.id ?? null;
      const tabs = store.getState().tabs;
      for (const tab of tabs) {
        if (tab.kind === "preview") continue;
        const entry = editors.get(tab.id);
        if (!entry || !entry.crepe) continue;
        // ソースモード中のタブは生テキスト編集中。Mermaidは描画されておらず、
        // 作り直すとソース編集が失われるためスキップする。
        if (entry.sourceMode) continue;
        const md = entry.crepe.getMarkdown();
        // ```mermaid / ~~~mermaid を含むタブだけ作り直す
        if (!/(?:^|\n)[ \t]*(?:`{3,}|~{3,})[ \t]*mermaid\b/i.test(md)) continue;
        // アクティブタブのスクロール位置を保ったまま作り直す（フォーカス移動も抑止）
        const prevScroll = tab.id === activeId ? entry.container.scrollTop : 0;
        store.setInitialOverride(tab.id, { content: md, baseline: entry.baseline });
        await this.recreate(tab, {
          noFocus: true,
          preserveScroll: prevScroll,
          preserveCodeBlockState: true,
        });
      }
    },

    async refreshPreviewPane(tabId: string) {
      const old = editors.get(tabId);
      const scroll = old?.container.scrollTop ?? 0;
      const zoom = old?.container.dataset.zoom;
      const tab = store.getState().tabs.find((t) => t.id === tabId);
      if (!tab) return;
      await this.recreate(tab, { noFocus: true, preserveScroll: scroll });
      const fresh = editors.get(tabId);
      if (fresh && zoom) {
        fresh.container.dataset.zoom = zoom;
        fresh.container
          .querySelector<HTMLElement>(".document")
          ?.style.setProperty("zoom", zoom);
      }
    },

    toggleSourceMode(tabId: string) {
      const entry = editors.get(tabId);
      if (!entry || !entry.crepe) return; // preview タブは対象外
      if (!entry.sourceMode) {
        // WYSIWYG → ソース
        const text = entry.crepe.getMarkdown();
        const pane = createSourcePane(text, (t) => {
          store.setDirty(tabId, t !== entry.baseline);
          for (const fn of contentListeners) fn(tabId);
        });
        entry.sourcePane = pane;
        entry.sourceMode = true;
        entry.container.classList.add("source-mode");
        entry.container.appendChild(pane.dom);
        requestAnimationFrame(() => pane.focus());
      } else {
        // ソース → WYSIWYG
        const text = entry.sourcePane?.getText() ?? "";
        entry.sourcePane?.destroy();
        entry.sourcePane = null;
        entry.sourceMode = false;
        entry.container.classList.remove("source-mode");
        // 編集テキストを Crepe ドキュメントへ反映（markdownUpdated が dirty を再計算）
        try {
          entry.crepe.editor.action(replaceAll(text));
        } catch (e) {
          console.error("replaceAll on source exit failed:", e);
        }
        focusActive();
      }
    },

    isSourceMode(tabId: string) {
      return !!editors.get(tabId)?.sourceMode;
    },

    focus: focusActive,

    runOnActive(fn) {
      const id = store.getActive()?.id;
      if (!id) return;
      const entry = editors.get(id);
      if (!entry || !entry.crepe) return;
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
      if (!entry || !entry.crepe) return null;
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

    async persistImages(tabId: string, mdFilePath: string): Promise<PersistResult> {
      const entry = editors.get(tabId);
      if (!entry || !entry.crepe) return { written: 0, failed: 0 };
      // ソースモード中は生テキストを保存するため、Crepe ドキュメント側の
      // 画像永続化は行わない（行うと書換が失われる/不要なファイル生成になる）。
      if (entry.sourceMode) return { written: 0, failed: 0 };
      const imgDir = imageDirForMdPath(mdFilePath);
      if (!imgDir) return { written: 0, failed: 0 };
      let view: EditorView | null = null;
      try {
        entry.crepe.editor.action((ctx) => {
          view = ctx.get(editorViewCtx) as EditorView;
        });
      } catch (e) {
        console.warn("persistImages: getView failed:", e);
        return { written: 0, failed: 0 };
      }
      if (!view) return { written: 0, failed: 0 };
      return persistEmbeddedImages(view, imgDir, new Date());
    },

    onContentChange(fn) {
      contentListeners.add(fn);
      return () => contentListeners.delete(fn);
    },
  };
}
