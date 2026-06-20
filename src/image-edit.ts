import { commandsCtx, editorViewCtx } from "@milkdown/kit/core";
import type { Editor } from "@milkdown/kit/core";
import { NodeSelection, TextSelection } from "@milkdown/kit/prose/state";
import type { Node as ProseNode } from "@milkdown/kit/prose/model";
import type { EditorView } from "@milkdown/kit/prose/view";
import { insertImageCommand } from "@milkdown/kit/preset/commonmark";

import { t } from "./i18n";
import { convertImageBlockToInline } from "./editor";

/**
 * Crepe で画像として扱われるノード名一覧。
 * - `image` : preset-commonmark のインライン画像
 * - `image-block` : @milkdown/components の image-block（キャプション付きブロック）
 */
const IMAGE_NODE_NAMES = new Set<string>(["image", "image-block"]);

/** image-block の ratio をピクセル幅として扱う閾値（editor.ts の IMG_PX_THRESHOLD と一致）。 */
const IMG_PX_THRESHOLD = 10;

export function isImageNode(node: ProseNode): boolean {
  return IMAGE_NODE_NAMES.has(node.type.name);
}

/** 現在の選択が画像ノードならその参照を返す。 */
export function findSelectedImage(
  view: EditorView,
): { node: ProseNode; pos: number } | null {
  const sel = view.state.selection;
  if (sel instanceof NodeSelection && isImageNode(sel.node)) {
    return { node: sel.node, pos: sel.from };
  }
  return null;
}

type PromptInput = {
  src: string;
  caption: string;
  /** 画像幅 (px)。0 か未定義は「未設定 = 自動」。 */
  width?: number;
  /** プロンプトに「元サイズ: ◯◯px」と表示するためのヒント。0 ならヒント省略。 */
  naturalWidth?: number;
  /** width プロンプトを表示するか。インライン画像 (`image`) では false。 */
  supportsWidth?: boolean;
};

type PromptResult = {
  src: string;
  caption: string;
  /** undefined: 触らない / 0: クリア (auto) / 正の整数: 明示幅 */
  width?: number;
};

/**
 * 画像のURL → 代替コメント → サイズ (px) を順に尋ねるプロンプト。
 * 既存値があれば編集、無ければ挿入用として動作する。
 * URL がキャンセル / 空文字なら null を返す。
 * width プロンプトは supportsWidth=true のときだけ表示される。
 */
export function promptForImage(initial?: PromptInput): PromptResult | null {
  const url = window.prompt(t("dlg.image.url"), initial?.src ?? "");
  if (url === null) return null;
  if (url === "") return null;
  const caption =
    window.prompt(t("dlg.image.alt"), initial?.caption ?? "") ?? "";

  if (!initial?.supportsWidth) {
    return { src: url, caption };
  }

  const naturalHint =
    initial.naturalWidth && initial.naturalWidth > 0
      ? t("dlg.image.size").replace("{natural}", String(initial.naturalWidth))
      : t("dlg.image.sizeNoHint");
  const initialWidth =
    initial.width && initial.width > 0 ? String(initial.width) : "";
  const widthRaw = window.prompt(naturalHint, initialWidth);
  if (widthRaw === null) {
    // 幅プロンプトでキャンセルされた場合: src/caption のみ返して幅は触らない
    return { src: url, caption };
  }
  const trimmed = widthRaw.trim();
  if (trimmed === "") {
    // 空欄 → 自動 (= ratio をリセット)
    return { src: url, caption, width: 0 };
  }
  const widthVal = parseInt(trimmed, 10);
  if (!Number.isFinite(widthVal) || widthVal < 0) {
    return { src: url, caption };
  }
  return { src: url, caption, width: widthVal };
}

/**
 * ノード種別ごとにキャプション系の attr 名が違うので吸収する。
 * - image: alt
 * - image-block: caption
 */
function captionAttrName(node: ProseNode): string {
  return node.type.name === "image-block" ? "caption" : "alt";
}

function readCaption(node: ProseNode): string {
  return (node.attrs[captionAttrName(node)] ?? "") as string;
}

/** image-block の DOM から実 img 要素 (= naturalWidth が読める) を取得。 */
function getImgDom(view: EditorView, pos: number): HTMLImageElement | null {
  const dom = view.nodeDOM(pos);
  if (!(dom instanceof HTMLElement)) return null;
  return dom.querySelector(
    'img[data-type="image-block"], img',
  ) as HTMLImageElement | null;
}

/**
 * 指定位置の画像ノードの src/caption (+ image-block なら ratio) を更新する。
 * 既存の attrs（title 等）は維持する。
 */
export function applyImageEdit(
  view: EditorView,
  pos: number,
  next: PromptResult,
): void {
  const node = view.state.doc.nodeAt(pos);
  if (!node || !isImageNode(node)) return;
  const captionKey = captionAttrName(node);
  const newAttrs: Record<string, unknown> = {
    ...node.attrs,
    src: next.src,
    [captionKey]: next.caption,
  };
  // image-block の幅指定 (px)
  if (node.type.name === "image-block" && next.width !== undefined) {
    // 0 → 自動 (= デフォルトの ratio=1 = 閾値以下 = レガシー扱い)
    // 正の整数 → そのまま ratio に格納してピクセル幅扱い
    newAttrs.ratio = next.width > 0 ? next.width : 1;
  }
  view.dispatch(
    view.state.tr.setNodeMarkup(pos, undefined, newAttrs).scrollIntoView(),
  );
}

/** image-block 用に PromptInput を組み立てる（natural サイズ取得など）。 */
function buildPromptInputFor(
  view: EditorView,
  pos: number,
  node: ProseNode,
): PromptInput {
  const isBlock = node.type.name === "image-block";
  if (!isBlock) {
    return {
      src: (node.attrs.src ?? "") as string,
      caption: readCaption(node),
      supportsWidth: false,
    };
  }
  const img = getImgDom(view, pos);
  const ratio = Number(node.attrs.ratio) || 0;
  return {
    src: (node.attrs.src ?? "") as string,
    caption: readCaption(node),
    width: ratio > IMG_PX_THRESHOLD ? Math.round(ratio) : 0,
    naturalWidth: img?.naturalWidth ?? 0,
    supportsWidth: true,
  };
}

/**
 * 既存画像の「横に」インライン画像を追加する。
 * - NodeSelection が image-block → インライン段落へ変換してから、その画像の直後へ追加
 * - NodeSelection が inline image → その直後へ追加
 * - カーソルが画像行の段落内 → カーソル位置へ追加
 * 画像間は半角スペース1個で区切る。
 */
export function insertImageBeside(
  view: EditorView,
  src: string,
  alt: string,
): void {
  const schema = view.state.schema;
  const imageType = schema.nodes.image;
  if (!imageType) return;

  let sel = view.state.selection;

  // image-block 選択時はインライン段落へ変換し、選択をその画像ノードに張り直す
  if (sel instanceof NodeSelection && sel.node.type.name === "image-block") {
    const paraStart = convertImageBlockToInline(view, sel.from);
    if (paraStart == null) return;
    const imgPos = paraStart + 1; // 段落の開きトークンの次がインライン image
    view.dispatch(
      view.state.tr.setSelection(NodeSelection.create(view.state.doc, imgPos)),
    );
    sel = view.state.selection;
  }

  // 挿入位置: inline image を選択中ならその直後、そうでなければカーソル位置
  const insertPos =
    sel instanceof NodeSelection ? sel.to : view.state.selection.to;

  const space = schema.text(" ");
  const img = imageType.create({ src, alt: alt ?? "" });
  const tr = view.state.tr.insert(insertPos, [space, img]);
  // カーソルを追加画像の直後へ
  const after = insertPos + space.nodeSize + img.nodeSize;
  tr.setSelection(TextSelection.create(tr.doc, after));
  view.dispatch(tr.scrollIntoView());
  view.focus();
}

/** 現在の選択/カーソルが既存画像（block/inline）に係っているか。 */
export function isAtExistingImage(view: EditorView): boolean {
  const sel = view.state.selection;
  if (sel instanceof NodeSelection && isImageNode(sel.node)) return true;
  // 段落内に inline image を含むか（画像行）
  const parent = sel.$from.parent;
  let hasImage = false;
  parent.forEach((c) => {
    if (c.type.name === "image") hasImage = true;
  });
  return hasImage;
}

/**
 * ツールバー / メニューから「画像」アクションが押されたときのエントリポイント。
 * 既存画像に係っている場合は「横に追加」、そうでなければ新規挿入。
 * 既存画像の「編集」はダブルクリック経由（editImageNodeAtPos）に集約。
 */
export function imageActionFromMenu(editor: Editor): void {
  editor.action((ctx) => {
    const view = ctx.get(editorViewCtx);
    // 既存画像に係っている場合は「横に追加」
    if (isAtExistingImage(view)) {
      const result = promptForImage({ src: "", caption: "" });
      if (!result) return;
      insertImageBeside(view, result.src, result.caption);
      return;
    }
    // それ以外は新規挿入（従来どおり）
    const result = promptForImage({ src: "", caption: "" });
    if (!result) return;
    ctx.get(commandsCtx).call(insertImageCommand.key, {
      src: result.src,
      alt: result.caption,
    });
  });
}

/**
 * ProseMirror Plugin の handleDoubleClickOn から呼ぶ画像編集エントリ。
 * 選択を画像ノードに揃えてから 3 ステップ プロンプトを開く。
 */
export function editImageNodeAtPos(
  view: EditorView,
  pos: number,
  node: ProseNode,
): void {
  view.dispatch(
    view.state.tr.setSelection(NodeSelection.create(view.state.doc, pos)),
  );
  const input = buildPromptInputFor(view, pos, node);
  const result = promptForImage(input);
  if (!result) return;
  applyImageEdit(view, pos, result);
}
