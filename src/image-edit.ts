import { commandsCtx, editorViewCtx, type CommandManager } from "@milkdown/kit/core";
import type { Editor } from "@milkdown/kit/core";
import { NodeSelection, TextSelection } from "@milkdown/kit/prose/state";
import type { Node as ProseNode } from "@milkdown/kit/prose/model";
import type { EditorView } from "@milkdown/kit/prose/view";
import { insertImageCommand } from "@milkdown/kit/preset/commonmark";

import { t } from "./i18n";
import { convertImageBlockToInline } from "./editor";
import { promptFields, type PromptField } from "./modal";
import { parseImageAlt, composeImageAlt } from "./image-row";

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
  /** 代替テキスト（alt の「説明|幅」の説明部分）。 */
  alt: string;
  /** キャプション（インライン画像は title、画像ブロックは caption）。 */
  caption: string;
  /** 画像幅 (px)。0 か未定義は「未設定 = 自動」。 */
  width?: number;
  /** ダイアログに「元サイズ: ◯◯px」と表示するためのヒント。0 ならヒント省略。 */
  naturalWidth?: number;
};

type PromptResult = {
  src: string;
  alt: string;
  caption: string;
  /** undefined: 触らない / 0: クリア (auto) / 正の整数: 明示幅 */
  width?: number;
};

/**
 * 画像の URL・代替テキスト・キャプション・幅 (px) を 1 枚のダイアログで尋ねる。
 * 既存値があれば編集、無ければ挿入用として動作する（title で見出しを切り替える）。
 * キャンセル、または URL が空なら null を返す。
 * markdown では `![代替テキスト|幅](URL "キャプション")` として保存される。
 */
export async function promptForImage(
  initial: PromptInput | undefined,
  title: string,
): Promise<PromptResult | null> {
  const sizeLabel =
    initial?.naturalWidth && initial.naturalWidth > 0
      ? t("dlg.image.size").replace("{natural}", String(initial.naturalWidth))
      : t("dlg.image.sizeNoHint");
  const fields: PromptField[] = [
    { label: t("dlg.image.url"), value: initial?.src ?? "" },
    { label: t("dlg.image.alt"), value: initial?.alt ?? "" },
    { label: t("dlg.image.caption"), value: initial?.caption ?? "" },
    {
      label: sizeLabel,
      value: initial?.width && initial.width > 0 ? String(initial.width) : "",
      numeric: true,
    },
  ];
  const values = await promptFields({ title, fields });
  if (values === null) return null;
  const url = values[0].trim();
  if (url === "") return null;
  // 「|」は幅の区切りに使うため、代替テキストからは除く
  const alt = values[1].replace(/\|/g, " ").trim();
  const caption = values[2].trim();

  const trimmed = values[3].trim();
  if (trimmed === "") {
    // 空欄 → 自動（幅指定を外す）
    return { src: url, alt, caption, width: 0 };
  }
  const widthVal = parseInt(trimmed, 10);
  if (!Number.isFinite(widthVal) || widthVal < 0) {
    return { src: url, alt, caption };
  }
  return { src: url, alt, caption, width: widthVal };
}

/** 画像ノードの DOM から実 img 要素 (= naturalWidth が読める) を取得。 */
function getImgDom(view: EditorView, pos: number): HTMLImageElement | null {
  const dom = view.nodeDOM(pos);
  if (dom instanceof HTMLImageElement) return dom;
  if (!(dom instanceof HTMLElement)) return null;
  return dom.querySelector(
    'img[data-type="image-block"], img',
  ) as HTMLImageElement | null;
}

/**
 * 指定位置の画像ノードの src・代替テキスト・キャプション・幅を更新する。
 * - インライン画像: alt に「代替テキスト|幅」、title にキャプションを入れる
 * - 画像ブロック: caption と ratio（= 幅）を更新する。画像ブロックは代替テキストを
 *   持てない（Crepe の仕様で読込時に捨てられる）ため、代替テキストが入力されたら
 *   インライン画像へ変換してから設定する
 */
export function applyImageEdit(
  view: EditorView,
  pos: number,
  next: PromptResult,
): void {
  let node = view.state.doc.nodeAt(pos);
  if (!node || !isImageNode(node)) return;
  if (node.type.name === "image-block" && next.alt !== "") {
    const paraStart = convertImageBlockToInline(view, pos);
    if (paraStart == null) return;
    pos = paraStart + 1; // 段落の開きトークンの次がインライン image
    node = view.state.doc.nodeAt(pos);
    if (!node || node.type.name !== "image") return;
  }
  let newAttrs: Record<string, unknown>;
  if (node.type.name === "image-block") {
    newAttrs = { ...node.attrs, src: next.src, caption: next.caption };
    if (next.width !== undefined) {
      // 0 → 自動 (= デフォルトの ratio=1 = 閾値以下 = レガシー扱い)
      // 正の整数 → そのまま ratio に格納してピクセル幅扱い
      newAttrs.ratio = next.width > 0 ? next.width : 1;
    }
  } else {
    const cur = parseImageAlt(node.attrs.alt as string);
    const width = next.width === undefined ? cur.width : next.width;
    newAttrs = {
      ...node.attrs,
      src: next.src,
      alt: composeImageAlt(next.alt, width),
      title: next.caption,
    };
  }
  view.dispatch(
    view.state.tr.setNodeMarkup(pos, undefined, newAttrs).scrollIntoView(),
  );
}

/** 既存の画像ノードからダイアログの初期値を組み立てる（natural サイズ取得など）。 */
function buildPromptInputFor(
  view: EditorView,
  pos: number,
  node: ProseNode,
): PromptInput {
  const img = getImgDom(view, pos);
  const naturalWidth = img?.naturalWidth ?? 0;
  if (node.type.name !== "image-block") {
    const { text, width } = parseImageAlt(node.attrs.alt as string);
    return {
      src: (node.attrs.src ?? "") as string,
      alt: text,
      caption: (node.attrs.title ?? "") as string,
      width,
      naturalWidth,
    };
  }
  const ratio = Number(node.attrs.ratio) || 0;
  return {
    src: (node.attrs.src ?? "") as string,
    alt: "",
    caption: (node.attrs.caption ?? "") as string,
    width: ratio > IMG_PX_THRESHOLD ? Math.round(ratio) : 0,
    naturalWidth,
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
  title = "",
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
  const img = imageType.create({ src, alt: alt ?? "", title });
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
export async function imageActionFromMenu(editor: Editor): Promise<void> {
  let view: EditorView | null = null;
  let commands: CommandManager | null = null;
  editor.action((ctx) => {
    view = ctx.get(editorViewCtx);
    commands = ctx.get(commandsCtx);
  });
  if (!view || !commands) return;
  const v: EditorView = view;
  const cmds: CommandManager = commands;
  // 既存画像に係っている場合は「横に追加」、それ以外は新規挿入（従来どおり）
  const beside = isAtExistingImage(v);
  const result = await promptForImage(
    { src: "", alt: "", caption: "" },
    t("dlg.image.titleInsert"),
  );
  if (!result) {
    v.focus();
    return;
  }
  const alt = composeImageAlt(result.alt, result.width ?? 0);
  if (beside) {
    insertImageBeside(v, result.src, alt, result.caption);
  } else {
    cmds.call(insertImageCommand.key, {
      src: result.src,
      alt,
      title: result.caption,
    });
  }
  v.focus();
}

/**
 * ProseMirror Plugin の handleDoubleClickOn から呼ぶ画像編集エントリ。
 * 選択を画像ノードに揃えてから編集ダイアログを開く。
 */
export async function editImageNodeAtPos(
  view: EditorView,
  pos: number,
  node: ProseNode,
): Promise<void> {
  view.dispatch(
    view.state.tr.setSelection(NodeSelection.create(view.state.doc, pos)),
  );
  const input = buildPromptInputFor(view, pos, node);
  const result = await promptForImage(input, t("dlg.image.titleEdit"));
  // ダイアログ表示中に文書が変わって位置がずれていたら何もしない
  const cur = view.state.doc.nodeAt(pos);
  if (!result || !cur || cur.type !== node.type) {
    view.focus();
    return;
  }
  applyImageEdit(view, pos, result);
  view.focus();
}
