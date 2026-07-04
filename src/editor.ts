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
import { Plugin, TextSelection, NodeSelection, Selection } from "@milkdown/kit/prose/state";
import type { EditorState, Transaction } from "@milkdown/kit/prose/state";
import { CellSelection } from "@milkdown/kit/prose/tables";
import type { Node as ProseNode } from "@milkdown/kit/prose/model";
import { DOMParser as ProseDOMParser } from "@milkdown/kit/prose/model";
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
import {
  remarkUnderline,
  underlineSchema,
  toggleUnderlineCommand,
  underlineKeymap,
} from "./underline";
import {
  remarkTextColor,
  textColorSchema,
  setTextColorCommand,
  textColorHandler,
} from "./text-color";
import {
  remarkHighlight,
  highlightSchema,
  setHighlightCommand,
  highlightHandler,
} from "./highlight";
import {
  remarkSupSub,
  superscriptSchema,
  subscriptSchema,
  toggleSuperscriptCommand,
  toggleSubscriptCommand,
  superscriptHandler,
  subscriptHandler,
} from "./supsub";
import {
  toggleTaskListCommand,
  insertCalloutCommand,
  clearFormattingCommand,
} from "./format-commands";
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
import { attachPreviewFold } from "./preview-fold";
import { mountPresentation, forgetPresentationState } from "./presentation-lazy";
import { ensureBlankLineBeforeTables } from "./md-normalize";
import { mermaidCodePreview } from "./mermaid-renderer";
import { docTheme } from "./theme";
import { ensureDocumentStyles, setHljsThemeStyle } from "./doc-styles";
import { t } from "./i18n";
import { replaceAll } from "@milkdown/kit/utils";
import { createSourcePane, type SourcePane } from "./source-mode";
import {
  formatImageAlt,
  NBSP,
  INDENT_NBSP,
  countLeadingNbsp,
} from "./image-row";

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

// 段落が「画像行」（インライン image を1個以上含み、画像と空白テキストのみ）か判定する。
function isImageRowParagraph(node: ProseNode): boolean {
  if (node.type.name !== "paragraph") return false;
  let hasImage = false;
  let ok = true;
  node.forEach((child) => {
    if (child.type.name === "image") hasImage = true;
    else if (child.isText) {
      // NBSP(インデント)と半角スペース(画像区切り)のみ許容
      if ((child.text ?? "").replace(/[\u00A0 ]/g, "") !== "") ok = false;
    } else ok = false;
  });
  return hasImage && ok;
}

// image-block（ブロック画像）を「インライン image 1個を内容とする段落」へ変換する。
// src と幅（ratio>閾値なら alt=幅）を引き継ぐ。変換後の段落の開始位置を返す（失敗時 null）。
export function convertImageBlockToInline(
  view: EditorView,
  pos: number,
): number | null {
  const node = view.state.doc.nodeAt(pos);
  if (!node || node.type.name !== "image-block") return null;
  const schema = view.state.schema;
  const paragraphType = schema.nodes.paragraph;
  const imageType = schema.nodes.image;
  if (!paragraphType || !imageType) return null;
  const ratio = Number(node.attrs.ratio) || 0;
  const alt = ratio > 10 ? String(Math.round(ratio)) : "";
  const inlineImage = imageType.create({ src: node.attrs.src ?? "", alt });
  const paragraph = paragraphType.create(null, inlineImage);
  view.dispatch(view.state.tr.replaceWith(pos, pos + node.nodeSize, paragraph));
  return pos; // 置換後、段落はこの位置から始まる
}

/**
 * 画像行の先頭インデントを ±1 段する（delta=+1 で字下げ、-1 で戻す）。
 * - 空選択・行頭(parentOffset===0)かつ段落が画像行のときに作用
 * - image-block を NodeSelection 中なら先にインライン段落へ変換（その後の再押下で字下げ可）
 * - それ以外は false を返し、リスト/コードブロック等の既定 Tab を妨げない
 */
function indentImageRow(
  state: EditorState,
  dispatch: ((tr: Transaction) => void) | undefined,
  view: EditorView | null,
  delta: 1 | -1,
): boolean {
  const sel = state.selection;

  // image-block を選択中: インライン段落へ変換（次回操作でインデント可能に）
  if (sel instanceof NodeSelection && sel.node.type.name === "image-block") {
    if (!view) return false;
    convertImageBlockToInline(view, sel.from);
    return true;
  }

  if (!sel.empty) return false;
  const { $from } = sel;
  if ($from.parentOffset !== 0) return false;
  const parent = $from.parent;
  if (!isImageRowParagraph(parent)) return false;

  const paraStart = $from.start(); // 段落内容の開始位置
  if (delta > 0) {
    const tr = state.tr.insertText(NBSP.repeat(INDENT_NBSP), paraStart);
    if (dispatch) dispatch(tr.scrollIntoView());
    return true;
  }
  const first = parent.firstChild;
  const lead = first && first.isText ? countLeadingNbsp(first.text ?? "") : 0;
  if (lead <= 0) return false;
  const remove = Math.min(lead, INDENT_NBSP);
  const tr = state.tr.delete(paraStart, paraStart + remove);
  if (dispatch) dispatch(tr.scrollIntoView());
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
  /**
   * ソースモード中、文書順 index 番目の見出し行へスクロールする。
   * 非ソース時・該当なしは false。コードフェンス内の # 行は見出しに数えない
   * （アウトライン側の見出し抽出と整合させるため）。
   */
  scrollSourceToHeading: (tabId: string, headingIndex: number) => boolean;
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
    } else if (tab.previewMode === "slideshow") {
      // プレゼン（スライドショー）。文書プレビューと同じ文書CSS・ハイライトCSSを
      // 注入し、同一HTMLをスライド単位に区切って見せる。
      ensureDocumentStyles();
      setHljsThemeStyle(docTheme.get().theme.highlightTheme);
      mountPresentation(container, tab.previewHtml ?? "", tab.id);
    } else {
      // プレビューの .document が参照する文書CSS・ハイライトCSSを、このウィンドウへ
      // 確実に注入する（別ウィンドウへ移送された場合に背景等が欠落するのを防ぐ）。
      // ensureDocumentStyles は冪等。
      ensureDocumentStyles();
      setHljsThemeStyle(docTheme.get().theme.highlightTheme);
      container.innerHTML = tab.previewHtml ?? "";
      // 開いた時点のエディタ拡大率を初期ズームとして引き継ぐ。
      // エディタの絶対pxではなく既定(15px)からの倍率を使い、プレビューのCSS zoomへ反映する。
      // 以降はプレビュー上の Ctrl+ホイールで独立して調整できる（main.ts の adjustPreviewZoom）。
      const EDITOR_DEFAULT_FONT_PX = 15; // settings.ts DEFAULT_SETTINGS.fontSize
      const PREVIEW_ZOOM_MIN = 0.5;
      const PREVIEW_ZOOM_MAX = 3.0;
      const editorPx =
        parseFloat(
          getComputedStyle(document.documentElement).getPropertyValue(
            "--editor-font-size",
          ),
        ) || EDITOR_DEFAULT_FONT_PX;
      const initialZoom = Math.min(
        PREVIEW_ZOOM_MAX,
        Math.max(PREVIEW_ZOOM_MIN, editorPx / EDITOR_DEFAULT_FONT_PX),
      );
      if (initialZoom !== 1) {
        container.dataset.zoom = String(initialZoom);
        container
          .querySelector<HTMLElement>(".document")
          ?.style.setProperty("zoom", String(initialZoom));
      }
      // 見出し折りたたみ（表示のみ）を取り付ける。
      attachPreviewFold(container);
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
    // リスト/段落の直後に空行なしで置かれた表を remark が段落テキストとして
    // 取り込み（→ ソース往復で `|` が `\|` にエスケープされ崩れる）のを防ぐため、
    // 入力段階で表の直前に空行を補う。mmd ラップはフェンス内なので影響しない。
    const initialValue = ensureBlankLineBeforeTables(
      override?.content ??
        (fileTypeOfPath(tab.filePath) === "mmd"
          ? wrapMermaidSource(tab.diskContent)
          : tab.diskContent),
    );

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

    // 下線マーク（<u>）。スキーマ・トグルコマンド・Mod-u キーマップを登録する。
    // 文字色（<span style="color:#hex">）・ハイライト（<mark>）・上付き/下付き
    // （<sup>/<sub>）の各マークと、タスクリスト/コールアウト/書式クリアの
    // コマンドも登録する。
    crepe.editor
      .use(underlineSchema)
      .use(toggleUnderlineCommand)
      .use(underlineKeymap)
      .use(textColorSchema)
      .use(setTextColorCommand)
      .use(highlightSchema)
      .use(setHighlightCommand)
      .use(superscriptSchema)
      .use(subscriptSchema)
      .use(toggleSuperscriptCommand)
      .use(toggleSubscriptCommand)
      .use(toggleTaskListCommand)
      .use(insertCalloutCommand)
      .use(clearFormattingCommand);

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
      テーブルのセルを1クリックしたときの挙動を「通常テキスト」に揃える。
      Crepe のテーブル NodeView は、現在の選択が「クリックしたセル内の
      TextSelection」でない限り、セル内容を丸ごと NodeSelection で選択する
      （1 クリックで I 字キャレットが出ずセルが選択される）。

      ProseMirror は DOM イベントを処理する前に eventBelongsToView() で
      NodeView の stopEvent() を先に評価する。そのため通常のプラグインの
      handleDOMEvents.mousedown では NodeView の判定に割り込めない（stopEvent が
      先に走り NodeSelection が予約される）。

      そこで「キャプチャフェーズ」の mousedown を view.dom に直接張る（PM 自身の
      バブルフェーズのリスナより必ず先に走る）。クリック回数（event.detail）で
      挙動を分岐させ、通常テキストと同じ操作感にする。
        - 1クリック: クリック座標のセル内へ TextSelection を先回りで置く。後続の
          NodeView 判定が「同一セル内の TextSelection」を検知して何もしない
          （return false）ため、PM 標準のキャレット配置・ドラッグ選択・
          ダブルクリック単語選択が効く。
        - 2クリック: 素通し（標準の単語選択に委ねる）。
        - 3クリック: セル内テキストを全選択（既定の prosemirror-tables は
          トリプルクリックでセルをブロック選択するため、それを抑止して置換する）。
        - 4クリック以上: セルそのものを選択（CellSelection）。
      3クリック以上は preventDefault + stopImmediatePropagation で PM／ブラウザの
      既定処理を止めてから独自の選択を適用する。
    */
    const tableCellDepth = (
      $pos: ReturnType<EditorState["doc"]["resolve"]>,
    ): number => {
      for (let d = $pos.depth; d > 0; d--) {
        const name = $pos.node(d).type.name;
        if (name === "table_cell" || name === "table_header") return d;
      }
      return -1;
    };
    const selectCellAllText = (view: EditorView, pos: number): void => {
      const $pos = view.state.doc.resolve(pos);
      const d = tableCellDepth($pos);
      if (d < 0) return;
      const sel = TextSelection.between(
        view.state.doc.resolve($pos.start(d)),
        view.state.doc.resolve($pos.end(d)),
      );
      view.dispatch(view.state.tr.setSelection(sel).scrollIntoView());
    };
    const selectWholeCell = (view: EditorView, pos: number): void => {
      const $pos = view.state.doc.resolve(pos);
      const d = tableCellDepth($pos);
      if (d < 0) return;
      view.dispatch(
        view.state.tr
          .setSelection(CellSelection.create(view.state.doc, $pos.before(d)))
          .scrollIntoView(),
      );
    };
    const tableCellCaretPlugin = new Plugin({
      view(editorView) {
        const onMouseDownCapture = (event: MouseEvent) => {
          if (event.button !== 0) return;
          const target = event.target as HTMLElement | null;
          if (!target) return;
          if (target.closest("button")) return; // 表の操作ボタンは除外
          if (!target.closest("td, th")) return;
          const coords = editorView.posAtCoords({
            left: event.clientX,
            top: event.clientY,
          });
          if (!coords) return;
          const detail = event.detail;
          if (detail === 1) {
            const sel = TextSelection.near(
              editorView.state.doc.resolve(coords.pos),
            );
            if (!editorView.state.selection.eq(sel)) {
              editorView.dispatch(editorView.state.tr.setSelection(sel));
            }
            return;
          }
          if (detail === 2) return; // 標準の単語選択に委ねる
          // 3クリック以上: 既定処理を止めて独自の選択を適用する。
          event.preventDefault();
          event.stopImmediatePropagation();
          if (detail === 3) selectCellAllText(editorView, coords.pos);
          else selectWholeCell(editorView, coords.pos); // 4クリック以上
        };
        editorView.dom.addEventListener("mousedown", onMouseDownCapture, true);
        return {
          destroy() {
            editorView.dom.removeEventListener(
              "mousedown",
              onMouseDownCapture,
              true,
            );
          },
        };
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
            if (!blockEl) {
              // インライン画像（横並び行の各画像）の拡縮: 幅は alt(数値) に保存
              const coordsInline = view.posAtCoords({
                left: event.clientX,
                top: event.clientY,
              });
              if (!coordsInline || coordsInline.inside < 0) return false;
              const inlineNode = view.state.doc.nodeAt(coordsInline.inside);
              if (!inlineNode || inlineNode.type.name !== "image") return false;
              event.preventDefault();
              event.stopPropagation();
              const idom = view.nodeDOM(coordsInline.inside);
              const inlineImg =
                idom instanceof HTMLImageElement
                  ? idom
                  : idom instanceof HTMLElement
                    ? idom.querySelector("img")
                    : null;
              const storedAlt = Number(inlineNode.attrs.alt) || 0;
              const base =
                storedAlt > IMG_PX_THRESHOLD
                  ? storedAlt
                  : Math.round(
                      inlineImg?.clientWidth || inlineImg?.naturalWidth || 320,
                    );
              const f = event.deltaY < 0 ? 1.1 : 1 / 1.1;
              const nextW = Math.max(
                IMG_PX_MIN,
                Math.min(IMG_PX_MAX, Math.round(base * f)),
              );
              if (inlineImg) {
                inlineImg.style.width = `${nextW}px`;
                inlineImg.style.height = "auto";
              }
              view.dispatch(
                view.state.tr.setNodeMarkup(coordsInline.inside, undefined, {
                  ...inlineNode.attrs,
                  alt: String(nextW),
                }),
              );
              return true;
            }
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
            if (node.type.name === "image") {
              const idom = editorView.nodeDOM(pos);
              const iimg =
                idom instanceof HTMLImageElement
                  ? idom
                  : idom instanceof HTMLElement
                    ? idom.querySelector("img")
                    : null;
              if (iimg) {
                const w = Number(node.attrs.alt) || 0;
                if (w > IMG_PX_THRESHOLD) {
                  iimg.style.width = `${w}px`;
                  iimg.style.height = "auto";
                } else if (iimg.style.width) {
                  iimg.style.width = "";
                }
              }
              return true;
            }
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

    /*
      画像の貼り付けを「現在行のカーソル位置にインライン画像」として挿入する。
      Crepe 既定は image-block（次行のブロック画像）になり、前後にカーソルを
      置けず横並びにもできないため、ここで横取りしてインライン image を入れる。
      data: URL は保存時に image-persist がファイル化する。複数画像は横並びで挿入。
    */
    const imagePastePlugin = new Plugin({
      props: {
        handleDOMEvents: {
          // Crepe 既定の貼り付け（image-block 化）より先に DOM の paste を捕まえる。
          // 本プラグインはプラグイン配列の先頭側にあるため最初に呼ばれる。
          paste(view, event) {
            const dt = (event as ClipboardEvent).clipboardData;
            if (!dt) return false;
            /*
              Excel 等の表計算からセル範囲をコピーすると、クリップボードに
              「表のビットマップ画像(PNG)」と「text/html の <table>」が同梱される。
              下の画像処理が先に画像を拾うと表が画像になってしまうため、HTML に
              <table> があるときは自前で GFM テーブルへ変換して挿入する
              （単に return false すると Crepe 既定の image-block 化が走り画像になる）。
            */
            const html = dt.getData("text/html");
            if (html && /<table[\s>]/i.test(html)) {
              try {
                const doc = new DOMParser().parseFromString(html, "text/html");
                /*
                  GFM テーブルのスキーマは content="table_header_row table_row+"
                  で、先頭行がヘッダ行であることを要求する。ヘッダ行の parseDOM は
                  <th> を含む <tr> しか受け付けないが、Excel/スプレッドシートは全セルを
                  <td> で出力し <th> を使わない。そのままだと先頭行がヘッダにならず
                  テーブル構築に失敗してテキスト化（または無反応）するため、各 <table>
                  の先頭行の <td> を <th> へ昇格させてから解析する。
                */
                doc.querySelectorAll("table").forEach((table) => {
                  const firstRow = table.querySelector("tr");
                  if (!firstRow || firstRow.querySelector("th")) return;
                  firstRow.querySelectorAll("td").forEach((td) => {
                    const th = doc.createElement("th");
                    th.innerHTML = td.innerHTML;
                    td.replaceWith(th);
                  });
                });
                const slice = ProseDOMParser.fromSchema(
                  view.state.schema,
                ).parseSlice(doc.body);
                // テーブルが組めず空スライスになった場合は既定の貼り付けに委ねる。
                if (slice.content.size === 0) return false;
                event.preventDefault();
                view.dispatch(view.state.tr.replaceSelection(slice).scrollIntoView());
                view.focus();
                return true;
              } catch (e) {
                console.error("table paste failed:", e);
                // 失敗時は既定の貼り付けに委ねる。
                return false;
              }
            }
            const files = Array.from(dt.files).filter((f) =>
              f.type.startsWith("image/"),
            );
            if (files.length === 0) return false;
            // インライン挿入はテキスト位置にのみ可能。それ以外は既定に委ねる。
            if (!(view.state.selection instanceof TextSelection)) return false;
            const imageType = view.state.schema.nodes.image;
            if (!imageType) return false;
            event.preventDefault();
            Promise.all(
              files.map(
                (f) =>
                  new Promise<string>((resolve, reject) => {
                    const r = new FileReader();
                    r.onload = () => resolve(String(r.result));
                    r.onerror = () => reject(r.error);
                    r.readAsDataURL(f);
                  }),
              ),
            )
              .then((urls) => {
                const schema = view.state.schema;
                const nodes: ProseNode[] = [];
                urls.forEach((url, i) => {
                  if (i > 0) nodes.push(schema.text(" "));
                  nodes.push(imageType.create({ src: url, alt: "" }));
                });
                // 段落をまたぐ選択にインラインを replaceWith すると例外になるため、
                // 同一ブロック内のときだけ範囲置換し、それ以外はカーソル位置へ挿入する。
                const sel = view.state.selection;
                const from = sel.from;
                const to = sel.$from.sameParent(sel.$to) ? sel.to : sel.from;
                const tr = view.state.tr.replaceWith(from, to, nodes);
                const size = nodes.reduce((n, node) => n + node.nodeSize, 0);
                const after = Math.min(from + size, tr.doc.content.size);
                tr.setSelection(TextSelection.create(tr.doc, after));
                view.dispatch(tr.scrollIntoView());
                view.focus();
              })
              .catch((e) => console.error("image paste failed:", e));
            return true;
          },
        },
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
        tableCellCaretPlugin,
        imageDoubleClickPlugin,
        imageWheelResizePlugin,
        imageBlockSizePlugin,
        imagePastePlugin,
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
          Tab: (state, dispatch, view) =>
            indentImageRow(state, dispatch, view ?? null, +1),
          "Shift-Tab": (state, dispatch, view) =>
            indentImageRow(state, dispatch, view ?? null, -1),
          /*
            リスト/表/引用などの直後に置かれたブロック（見出し等）の先頭行で
            ArrowUp を押したとき、間に gapcursor を挟まず直前ブロックの最終行へ
            キャレットを移す。ProseMirror 既定はこれらブロック境界で gapcursor を
            作るため、1 回の ArrowUp では上のブロックへ入れず「上に移動できない」
            と感じる問題を解消する。
            キャレットは「現在の水平位置（列）」を保ったまま直前ブロックの最終行へ
            移す。行頭にいれば行頭へ、途中にいれば同じ列付近へ着地する。
          */
          ArrowUp: (state, dispatch, view) => {
            if (!view) return false;
            const { selection } = state;
            if (!selection.empty) return false;
            // 折り返しの途中（上端の視覚行でない）なら既定の行内移動に任せる。
            if (!view.endOfTextblock("up")) return false;
            const $head = selection.$head;
            if ($head.depth < 1) return false;
            // 現在の最上位ブロックの直前位置と、その直前の兄弟ブロック。
            const beforePos = $head.before(1);
            const prev = state.doc.resolve(beforePos).nodeBefore;
            if (!prev) return false;
            const prevName = prev.type.name;
            const isList =
              prevName === "bullet_list" || prevName === "ordered_list";
            const isTable = prevName === "table";
            const isQuote = prevName === "blockquote";
            // 空段落（＝空行）は既定の上移動が飛び越してしまうため、ここで拾う。
            const isEmptyPara =
              prevName === "paragraph" && prev.content.size === 0;
            // 既定では gapcursor で止まる/空行を飛ばすブロックのみ介入する
            // （非空の段落/見出し同士は既定の列保持移動で十分なので触らない）。
            if (!isList && !isTable && !isQuote && !isEmptyPara) return false;
            // 直前ブロックの「最終行の実在テキスト位置」を求める（beforePos-1 は
            // ブロックの閉じ境界で textblock 外のため、Selection.near で内側の
            // 選択可能位置へ寄せる）。
            const endSel = Selection.near(
              state.doc.resolve(beforePos - 1),
              -1,
            );
            let pos = endSel.head; // フォールバック: 直前ブロックの末尾
            // 着地位置を Selection.near で寄せる際の探索方向。表のセル先頭境界は
            // 前方(+1)へ寄せないと前のセル末尾へ戻ってしまうため向きを分ける。
            let bias: 1 | -1 = -1;
            if (isTable) {
              // 表は「一番下の行の先頭セル」へ移す。座標解決は WebView の差異で
              // 不安定（先頭行に着地する）なため、文書構造から決定論的に求める。
              let p = beforePos - prev.nodeSize + 1; // 表内容の先頭
              for (let i = 0; i < prev.childCount - 1; i++) {
                p += prev.child(i).nodeSize; // 最終行の直前まで進める
              }
              pos = p + 2; // 最終行 → 先頭セル → 先頭子(段落)の内側
              bias = 1;
            } else {
              // リスト/引用/空行は左マージンで座標解決がぶれるため、文字オフセット
              // （列）で移す。行頭(offset 0)なら直前ブロック最終行の行頭へ。
              const $end = endSel.$head;
              const col = Math.min($head.parentOffset, $end.parent.content.size);
              pos = $end.start() + col;
            }
            const target = Selection.near(state.doc.resolve(pos), bias);
            if (dispatch) dispatch(state.tr.setSelection(target).scrollIntoView());
            return true;
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
        // <u>/</u> の html ノードペアを underline ノードへ畳む。
        { plugin: remarkUnderline, options: {} },
        // <span style="color:#hex">/</span> の html ノードペアを textColor ノードへ畳む。
        { plugin: remarkTextColor, options: {} },
        // <mark…>/</mark> の html ノードペアを highlight ノードへ畳む。
        { plugin: remarkHighlight, options: {} },
        // <sup>/<sub> の html ノードペアを superscript/subscript ノードへ畳む。
        { plugin: remarkSupSub, options: {} },
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
          /*
            underline ノード（下線マーク）の出力ハンドラ。
            <u> + 子要素 + </u> に直列化する。
          */
          underline: ((node: unknown, _parent: unknown, state: unknown, info: unknown) => {
            const s = state as {
              containerPhrasing: (node: unknown, info: unknown) => string;
            };
            return "<u>" + s.containerPhrasing(node, info) + "</u>";
          }) as never,
          /*
            textColor ノード（文字色マーク）の出力ハンドラ。
            <span style="color:#hex"> + 子要素 + </span> に直列化する。
          */
          textColor: (textColorHandler) as never,
          // highlight → <mark> / <mark style="background:#hex">
          highlight: (highlightHandler) as never,
          // superscript/subscript → <sup>/<sub>
          superscript: (superscriptHandler) as never,
          subscript: (subscriptHandler) as never,
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

    const detachLineNumbers = attachLineNumbers(
      container,
      () => crepe.getMarkdown(),
      () => pmView,
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
        forgetPresentationState(tabId);
        return;
      }

      const entry = editors.get(tabId);
      if (!entry) return;
      editors.delete(tabId);
      await destroyEntry(entry);
      // プレゼンタブの現在スライド位置の記憶を破棄する（更新では破棄しない）。
      forgetPresentationState(tabId);
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
          entry.crepe.editor.action(
            replaceAll(ensureBlankLineBeforeTables(text)),
          );
        } catch (e) {
          console.error("replaceAll on source exit failed:", e);
        }
        focusActive();
      }
    },

    isSourceMode(tabId: string) {
      return !!editors.get(tabId)?.sourceMode;
    },

    scrollSourceToHeading(tabId: string, headingIndex: number) {
      const entry = editors.get(tabId);
      if (!entry || !entry.sourceMode || !entry.sourcePane) return false;
      // 注: ATX 見出し（#）のみ数える。本エディタは setext 見出し（=== / ---）を
      // 出力しないため通常は整合するが、外部由来の setext 見出しを含む文書では
      // アウトライン側の番号とずれる可能性がある（既知の制約）。
      const lines = entry.sourcePane.getText().split("\n");
      let inFence = false;
      let count = -1;
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        // ```／~~~ フェンスの開閉を追跡し、コード内の # は見出しに数えない。
        if (/^\s{0,3}(```|~~~)/.test(line)) {
          inFence = !inFence;
          continue;
        }
        if (!inFence && /^\s{0,3}#{1,6}\s/.test(line)) {
          count++;
          if (count === headingIndex) {
            entry.sourcePane.scrollToLine(i + 1);
            return true;
          }
        }
      }
      return false;
    },

    focus: focusActive,

    runOnActive(fn) {
      const id = store.getActive()?.id;
      if (!id) return;
      const entry = editors.get(id);
      if (!entry || !entry.crepe) return;
      // ソースモード中は WYSIWYG が非表示。隠れた Crepe を操作しても見えず、
      // 退出時の replaceAll で破棄されるだけなので、整形系コマンドは無効化する。
      if (entry.sourceMode) return;
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
      // ソースモード中は WYSIWYG の view を返さない（コードブロック化や検索が
      // 隠れた doc に作用するのを防ぐ。呼び出し側は null で no-op になる）。
      if (entry.sourceMode) return null;
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
