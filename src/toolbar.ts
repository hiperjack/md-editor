import { commandsCtx, type CommandManager } from "@milkdown/kit/core";
import {
  toggleStrongCommand,
  toggleEmphasisCommand,
  toggleInlineCodeCommand,
  wrapInBlockquoteCommand,
  wrapInBulletListCommand,
  wrapInOrderedListCommand,
  wrapInHeadingCommand,
  insertHrCommand,
  toggleLinkCommand,
} from "@milkdown/kit/preset/commonmark";
import { toggleStrikethroughCommand, insertTableCommand } from "@milkdown/kit/preset/gfm";
import { setHighlightCommand } from "./highlight";
import { toggleSuperscriptCommand, toggleSubscriptCommand } from "./supsub";
import {
  toggleTaskListCommand,
  insertCalloutCommand,
  clearFormattingCommand,
  CALLOUT_TYPES,
  type CalloutType,
} from "./format-commands";

import { type EditorHost, createCodeBlockFromSelection } from "./editor";
import { imageActionFromMenu } from "./image-edit";
import { toggleUnderlineCommand } from "./underline";
import { setTextColorCommand } from "./text-color";
import {
  showColorPalette,
  showHighlightPalette,
  closeColorPalette,
  getColorPaletteEl,
} from "./color-palette";
import {
  showContextMenu,
  closeContextMenu,
  getContextMenuEl,
  type MenuItem,
} from "./context-menu";
import { settings } from "./settings";
import { t, onLangChange } from "./i18n";

type Action = () => void;

type ButtonSpec = {
  /** ツールバー内で識別するキー（メニューイベントとも共通） */
  key: string;
  /** SVGの `d` 属性（24x24基準） */
  icon: string;
  /** i18n キー（"sep" の場合は空でもよい） */
  titleKey: string;
  /** "right" を指定すると右寄せ。最初に出現したものより前にflex-spacerが差し込まれる。 */
  align?: "right";
  /**
   * タブ種別による表示制御（未指定なら常時表示）。
   *  - "editor": 編集タブのみ表示（書式系ボタン）。
   *  - "editorExport": 編集タブとHTMLプレビュー(export)のみ表示（折りたたみ全解除など）。
   *  - "hideSlideshow": プレゼンタブでは隠す（それ以外は表示）。
   * 実際の出し分けは body[data-tabkind] とCSSで行う。
   */
  vis?: "editor" | "editorExport" | "hideSlideshow";
};

// Lucide由来の単純なSVGパス（24x24, stroke-based）
// 選択時ポップアップツールバー（selection-toolbar.ts）でも共用する。
export const ICONS: Record<string, string> = {
  file_new:
    "M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8zM14 2v6h6M12 11v6M9 14h6",
  file_open:
    "M6 14l1.45-2.9A2 2 0 0 1 9.24 10H20a2 2 0 0 1 1.94 2.5l-1.55 6a2 2 0 0 1-1.94 1.5H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h3.93a2 2 0 0 1 1.66.9l.82 1.2a2 2 0 0 0 1.66.9H18a2 2 0 0 1 2 2v2",
  file_save:
    "M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2zM17 21v-8H7v8M7 3v5h8",
  file_save_as:
    "M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2zM12 9v8M8 13l4 4 4-4",
  file_export:
    "M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3",
  eye: "M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7zM12 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6z",
  presentation: "M2 3h20M21 3v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V3M7 21l5-5 5 5",
  bold: "M6 4h8a4 4 0 0 1 4 4 4 4 0 0 1-4 4H6zM6 12h9a4 4 0 0 1 4 4 4 4 0 0 1-4 4H6z",
  italic: "M19 4h-9M14 20H5M15 4 9 20",
  underline: "M6 4v6a6 6 0 0 0 12 0V4M4 20h16",
  // 文字色: "A"。下のカラーバーと右下の▼は createToolbar が別要素で描く。
  text_color: "m7 16 5-12 5 12M8.9 12h6.2",
  // ハイライト: マーカーペン（lucide highlighter）。カラーバー・▼は文字色と同様。
  highlight: "m9 11-6 6v3h9l3-3M22 12l-4.6 4.6a2 2 0 0 1-2.8 0l-5.2-5.2a2 2 0 0 1 0-2.8L14 4z",
  sup: "m4 19 8-12m-8 0 8 12M20 12h-4c0-1.5.44-2 1.5-2.5S20 8.33 20 7c0-1-.8-2-2-2s-2 .7-2 2",
  sub: "m4 5 8 12M4 17 12 5M20 19h-4c0-1.5.44-2 1.5-2.5S20 15.33 20 14c0-1-.8-2-2-2s-2 .7-2 2",
  tasklist: "M3 5h6v6H3zM5.2 7.6l1.3 1.3 2.2-2.6M13 8h8M3 14h6v6H3zM13 17h8",
  callout: "M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2zM12 7v4M12 15h.01",
  eraser: "m7 21-4.3-4.3c-1-1-1-2.5 0-3.4l9.6-9.6c1-1 2.5-1 3.4 0l5.6 5.6c1 1 1 2.5 0 3.4L13 21M22 21H7M5 11l9 9",
  // オーバーフロー「»」（隠れたボタンのメニューを開く）
  chevrons_right: "m6 17 5-5-5-5M13 17l5-5-5-5",
  strike: "M16 4H9a3 3 0 0 0-2.83 4M14 12a4 4 0 0 1 0 8H6M4 12h16",
  code: "m16 18 6-6-6-6M8 6l-6 6 6 6",
  h1: "M4 12h8M4 18V6M12 18V6M17 12l3-2v8",
  h2: "M4 12h8M4 18V6M12 18V6M21 18h-4c0-4 4-3 4-6 0-1.5-2-2.5-4-1",
  h3: "M4 12h8M4 18V6M12 18V6M16 10h4v4h-3M20 14v4h-4",
  h4: "M4 12h8M4 18V6M12 18V6M17 10v5h4M21 10v8",
  bullet: "M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01",
  ordered: "M10 6h11M10 12h11M10 18h11M4 6h1v4M4 10h2M6 18H4c0-1 2-2 2-3s-1-1.5-2-1",
  quote: "M3 21c3 0 7-1 7-8V5c0-1.25-.756-2.017-2-2H4c-1.25 0-2 .75-2 1.972V11c0 1.25.75 2 2 2 1 0 1 0 1 1v1c0 1-1 2-2 2s-1 .008-1 1.031V20c0 1 0 1 1 1zM15 21c3 0 7-1 7-8V5c0-1.25-.757-2.017-2-2h-4c-1.25 0-2 .75-2 1.972V11c0 1.25.75 2 2 2h.75c1 0 1.25.25 1.25 1.25v.75c0 1-1 2-2 2s-1.008.008-1.008 1.031V20c0 1 .008 1 1.008 1z",
  codeblock:
    "M5 4h14a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2zM10 9l-3 3 3 3M14 9l3 3-3 3",
  table:
    "M3 3h18v18H3zM3 9h18M3 15h18M9 3v18M15 3v18",
  link: "M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71",
  image:
    "M3 5h18a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2zM8.5 11A1.5 1.5 0 1 1 7 9.5 1.5 1.5 0 0 1 8.5 11zM21 15l-5-5L5 21",
  hr: "M5 12h14",
  panel_left:
    "M3 3h18a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2zM9 3v18",
  settings:
    "M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09a1.65 1.65 0 0 0-1-1.51 1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09a1.65 1.65 0 0 0 1.51-1 1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33h0a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51h0a1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82v0a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z",
  // 折りたたみを全解除（chevrons-up-down: 上下へ開く＝展開）
  expand_all: "M7 15l5 5 5-5M7 9l5-5 5 5",
  // ソース表示（生Markdown）。インラインコードの <> と区別するため中央にスラッシュを足した </>。
  source: "m18 16 4-4-4-4M6 8l-4 4 4 4M14.5 4l-5 16",
};

const BUTTONS: ButtonSpec[] = [
  // 左端: アウトラインパネル（左サイドバー）の表示トグル。パネルの真上に配置。
  { key: "view_outline", icon: ICONS.panel_left, titleKey: "tb.outline" },
  { key: "sep", icon: "", titleKey: "" },
  { key: "file_new", icon: ICONS.file_new, titleKey: "tb.file_new" },
  { key: "file_open", icon: ICONS.file_open, titleKey: "tb.file_open" },
  { key: "file_save", icon: ICONS.file_save, titleKey: "tb.file_save" },
  { key: "file_save_as", icon: ICONS.file_save_as, titleKey: "tb.file_save_as" },
  // 出力ボタン: ホバー/クリックで「HTML出力・印刷・プレゼンHTML・プレゼンPDF」のメニューを開く。
  { key: "file_export_menu", icon: ICONS.file_export, titleKey: "tb.export" },
  { key: "file_html_preview", icon: ICONS.eye, titleKey: "tb.file_html_preview" },
  { key: "file_presentation", icon: ICONS.presentation, titleKey: "tb.file_presentation" },
  { key: "view_source", icon: ICONS.source, titleKey: "tb.source_toggle" },
  // プレゼン操作バーの差し込み口。
  { key: "pres_slot", icon: "", titleKey: "" },
  // ソース表示の横の区切り。プレゼンタブでは操作バー先頭側に区切りを置くため隠す。
  { key: "sep", icon: "", titleKey: "", vis: "hideSlideshow" },
  { key: "fmt_h1", icon: ICONS.h1, titleKey: "tb.h1", vis: "editor" },
  { key: "fmt_h2", icon: ICONS.h2, titleKey: "tb.h2", vis: "editor" },
  { key: "fmt_h3", icon: ICONS.h3, titleKey: "tb.h3", vis: "editor" },
  { key: "fmt_h4", icon: ICONS.h4, titleKey: "tb.h4", vis: "editor" },
  { key: "sep", icon: "", titleKey: "", vis: "editor" },
  { key: "fmt_bold", icon: ICONS.bold, titleKey: "tb.bold", vis: "editor" },
  { key: "fmt_italic", icon: ICONS.italic, titleKey: "tb.italic", vis: "editor" },
  { key: "fmt_underline", icon: ICONS.underline, titleKey: "tb.underline", vis: "editor" },
  // 文字色/ハイライト: クリック=直近色を適用、ホバー=パレットを開く（右下に▼バッジ）。
  { key: "fmt_text_color", icon: ICONS.text_color, titleKey: "tb.textColor", vis: "editor" },
  { key: "fmt_highlight", icon: ICONS.highlight, titleKey: "tb.highlight", vis: "editor" },
  { key: "fmt_strike", icon: ICONS.strike, titleKey: "tb.strike", vis: "editor" },
  { key: "fmt_code", icon: ICONS.code, titleKey: "tb.code", vis: "editor" },
  { key: "fmt_sup", icon: ICONS.sup, titleKey: "tb.sup", vis: "editor" },
  { key: "fmt_sub", icon: ICONS.sub, titleKey: "tb.sub", vis: "editor" },
  { key: "fmt_clear", icon: ICONS.eraser, titleKey: "tb.clearFormat", vis: "editor" },
  { key: "sep", icon: "", titleKey: "", vis: "editor" },
  { key: "fmt_bullet", icon: ICONS.bullet, titleKey: "tb.bullet", vis: "editor" },
  { key: "fmt_ordered", icon: ICONS.ordered, titleKey: "tb.ordered", vis: "editor" },
  { key: "fmt_task", icon: ICONS.tasklist, titleKey: "tb.tasklist", vis: "editor" },
  { key: "fmt_quote", icon: ICONS.quote, titleKey: "tb.quote", vis: "editor" },
  // コールアウト: ホバー/クリックで種類（NOTE/TIP/…）のメニューを開く。
  { key: "fmt_callout", icon: ICONS.callout, titleKey: "tb.callout", vis: "editor" },
  { key: "fmt_codeblock", icon: ICONS.codeblock, titleKey: "tb.codeblock", vis: "editor" },
  { key: "sep", icon: "", titleKey: "", vis: "editor" },
  { key: "fmt_table", icon: ICONS.table, titleKey: "tb.table", vis: "editor" },
  { key: "fmt_link", icon: ICONS.link, titleKey: "tb.link", vis: "editor" },
  { key: "fmt_image", icon: ICONS.image, titleKey: "tb.image", vis: "editor" },
  { key: "fmt_hr", icon: ICONS.hr, titleKey: "tb.hr", vis: "editor" },
  // 右端側のグループ: spacerの右に 全展開 → 区切り → 設定 の順で並ぶ。
  // 全展開はHTMLプレビューでも有効。区切りと設定は常時表示（設定ボタンの左に区切り）。
  { key: "view_expand_all", icon: ICONS.expand_all, titleKey: "tb.expand_all", align: "right", vis: "editorExport" },
  { key: "sep", icon: "", titleKey: "", align: "right" },
  { key: "view_font", icon: ICONS.settings, titleKey: "tb.settings", align: "right" },
];

export function svg(d: string): string {
  return `<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="${d}"/></svg>`;
}

/** アクティブエディタのコマンドを実行する（ツールバー/選択バー共用）。 */
function runOnEditor(
  editor: EditorHost,
  fn: (commands: CommandManager) => void,
): void {
  editor.runOnActive((ed) => {
    ed.action((ctx) => {
      fn(ctx.get(commandsCtx));
    });
  });
}

/**
 * 文字色パレットを指定位置に開き、選択色を適用する（直近色も更新）。
 * ツールバー・書式メニュー・選択時ポップアップツールバーで共用する。
 */
export function openTextColorPaletteAt(
  editor: EditorHost,
  anchor: { x: number; y: number },
): void {
  showColorPalette(anchor, (color) => {
    if (color) settings.setLastTextColor(color);
    runOnEditor(editor, (c) => c.call(setTextColorCommand.key, color ?? undefined));
  });
}

/** ハイライトパレット版。""=標準マーカー / null=解除。 */
export function openHighlightPaletteAt(
  editor: EditorHost,
  anchor: { x: number; y: number },
): void {
  showHighlightPalette(anchor, (color) => {
    if (color !== null) settings.setLastHighlightColor(color);
    runOnEditor(editor, (c) => c.call(setHighlightCommand.key, color ?? undefined));
  });
}

/**
 * ポップアップのアンカー座標。ツールバーの該当ボタンが可視ならその直下、
 * 不可視（メニュー起動等）ならキャレット位置、どちらも無ければ画面上部中央。
 */
function anchorForButton(
  editor: EditorHost,
  key: string,
): { x: number; y: number } {
  const btn = document.querySelector<HTMLElement>(
    `.toolbar-btn[data-action="${key}"]`,
  );
  if (btn && btn.offsetParent !== null) {
    const r = btn.getBoundingClientRect();
    return { x: r.left, y: r.bottom + 4 };
  }
  const view = editor.getActiveView();
  if (view) {
    const c = view.coordsAtPos(view.state.selection.head);
    return { x: c.left, y: c.bottom + 4 };
  }
  return { x: window.innerWidth / 2, y: 80 };
}

/**
 * ツールバーアクション。menuイベントとtoolbarクリックの両方から呼ばれる。
 */
export function makeToolbarActions(editor: EditorHost): Record<string, Action> {
  const run = (fn: (commands: CommandManager) => void) => {
    editor.runOnActive((ed) => {
      ed.action((ctx) => {
        fn(ctx.get(commandsCtx));
      });
    });
  };

  const promptLink = (cb: (href: string) => void) => {
    const url = window.prompt("リンク先URLを入力してください", "https://");
    if (!url) return;
    cb(url);
  };

  return {
    fmt_bold: () => run((c) => c.call(toggleStrongCommand.key)),
    fmt_italic: () => run((c) => c.call(toggleEmphasisCommand.key)),
    fmt_underline: () => run((c) => c.call(toggleUnderlineCommand.key)),
    // ボタンクリック: 直近の色をそのまま適用する。
    fmt_text_color: () =>
      run((c) => c.call(setTextColorCommand.key, settings.get().lastTextColor)),
    // ホバー（および書式メニュー）: パレットを開いて選んだ色を適用。
    fmt_text_color_menu: () =>
      openTextColorPaletteAt(editor, anchorForButton(editor, "fmt_text_color")),
    // ハイライト: クリック=直近（""=標準マーカー）、ホバー/メニュー=パレット。
    fmt_highlight: () =>
      run((c) => c.call(setHighlightCommand.key, settings.get().lastHighlightColor)),
    fmt_highlight_menu: () =>
      openHighlightPaletteAt(editor, anchorForButton(editor, "fmt_highlight")),
    fmt_sup: () => run((c) => c.call(toggleSuperscriptCommand.key)),
    fmt_sub: () => run((c) => c.call(toggleSubscriptCommand.key)),
    fmt_clear: () => run((c) => c.call(clearFormattingCommand.key)),
    // タスクリスト: リスト外なら箇条書き化してからチェックボックスをトグルする。
    fmt_task: () =>
      run((c) => {
        c.call(wrapInBulletListCommand.key);
        c.call(toggleTaskListCommand.key);
      }),
    // コールアウト: 種類メニューを開く（ホバー・書式メニュー共用）。
    fmt_callout_menu: () => {
      const anchor = anchorForButton(editor, "fmt_callout");
      showContextMenu(
        anchor.x,
        anchor.y,
        CALLOUT_TYPES.map((kind) => ({
          type: "item" as const,
          label: kind,
          action: () => run((c) => c.call(insertCalloutCommand.key, kind as CalloutType)),
        })),
      );
    },
    fmt_strike: () => run((c) => c.call(toggleStrikethroughCommand.key)),
    fmt_code: () => run((c) => c.call(toggleInlineCodeCommand.key)),
    fmt_h1: () => run((c) => c.call(wrapInHeadingCommand.key, 1)),
    fmt_h2: () => run((c) => c.call(wrapInHeadingCommand.key, 2)),
    fmt_h3: () => run((c) => c.call(wrapInHeadingCommand.key, 3)),
    fmt_h4: () => run((c) => c.call(wrapInHeadingCommand.key, 4)),
    fmt_bullet: () => run((c) => c.call(wrapInBulletListCommand.key)),
    fmt_ordered: () => run((c) => c.call(wrapInOrderedListCommand.key)),
    fmt_quote: () => run((c) => c.call(wrapInBlockquoteCommand.key)),
    fmt_codeblock: () => {
      // 既定の setBlockType は hardbreak（改行）を捨てるため、改行を保持する
      // 独自実装で選択範囲を単一のコードブロックへ変換する。
      const view = editor.getActiveView();
      if (view) {
        createCodeBlockFromSelection(view);
        view.focus();
      }
    },
    fmt_table: () =>
      run((c) => c.call(insertTableCommand.key, { row: 3, col: 3 })),
    fmt_hr: () => run((c) => c.call(insertHrCommand.key)),
    fmt_link: () =>
      promptLink((href) =>
        run((c) => c.call(toggleLinkCommand.key, { href, title: "" })),
      ),
    // 画像ノードが選択中なら src/alt を編集、そうでなければ新規挿入。
    fmt_image: () => editor.runOnActive(imageActionFromMenu),
    // view_source（ソース表示トグル）は main.ts の viewActions 側で定義し、
    // ツールバーにはマージ済みアクションとして渡される。
  };
}

/**
 * ボタンのホバーでポップアップを開閉する。
 * ボタンとポップアップの間の隙間を跨ぐ移動で閉じないよう、mouseleave からの
 * クローズは短い遅延（ポップアップ側の mouseenter でキャンセル）で行う。
 * 選択時ポップアップツールバー（selection-toolbar.ts）でも共用する。
 */
export function wireHoverPopup(
  btn: HTMLElement,
  open: () => void,
  getEl: () => HTMLElement | null,
  close: () => void,
): void {
  let openTimer: number | null = null;
  let closeTimer: number | null = null;
  // このボタンが開いたポップアップ要素。パレット等は複数ボタンで共有されるため、
  // 「開いているか」ではなく「自分が開いたものか」で開閉を判断する。
  // （隣のボタンへ直接移動したとき、開き直しをスキップしたり、古い遅延クローズが
  //  新しいポップアップを巻き添えで閉じたりするのを防ぐ。）
  let ownedEl: HTMLElement | null = null;
  const cancelClose = (): void => {
    if (closeTimer !== null) {
      clearTimeout(closeTimer);
      closeTimer = null;
    }
  };
  const scheduleClose = (): void => {
    cancelClose();
    closeTimer = window.setTimeout(() => {
      if (ownedEl && getEl() === ownedEl) close();
      ownedEl = null;
    }, 300);
  };
  const openNow = (): void => {
    cancelClose();
    // 自分のポップアップが開いたままなら何もしない。他のボタンのものなら開き直す。
    if (ownedEl && getEl() === ownedEl) return;
    open();
    ownedEl = getEl();
    if (ownedEl) {
      ownedEl.addEventListener("mouseenter", cancelClose);
      ownedEl.addEventListener("mouseleave", scheduleClose);
    }
  };
  btn.addEventListener("mouseenter", () => {
    if (openTimer !== null) clearTimeout(openTimer);
    openTimer = window.setTimeout(openNow, 150);
  });
  btn.addEventListener("mouseleave", () => {
    if (openTimer !== null) {
      clearTimeout(openTimer);
      openTimer = null;
    }
    scheduleClose();
  });
}

export function createToolbar(
  parent: HTMLElement,
  actions: Record<string, Action>,
): void {
  parent.innerHTML = "";

  // 出力メニュー（HTML出力・印刷・プレゼンHTML・プレゼンPDF）。
  // 項目はファイルメニューと同じアクションを共有する。
  const openExportMenu = (btn: HTMLElement): void => {
    const r = btn.getBoundingClientRect();
    showContextMenu(r.left, r.bottom + 2, [
      { type: "item", label: t("menu.exportHtml"), shortcut: "Ctrl+Shift+E", action: () => actions.file_export_html?.() },
      { type: "item", label: t("menu.print"), shortcut: "Ctrl+P", action: () => actions.file_print?.() },
      { type: "separator" },
      { type: "item", label: t("menu.presentationHtml"), action: () => actions.file_pres_html?.() },
      { type: "item", label: t("menu.presentationPdf"), action: () => actions.file_pres_pdf?.() },
    ]);
  };

  const titleUpdaters: Array<() => void> = [];
  let spacerInserted = false;

  // オーバーフロー対象（spacer より左のボタン・区切り）と「»」ボタン。
  const collapsibles: { el: HTMLElement; spec: ButtonSpec }[] = [];
  const moreBtn = document.createElement("button");
  moreBtn.className = "toolbar-btn toolbar-overflow-hidden";
  moreBtn.title = t("tb.more");
  moreBtn.dataset.action = "toolbar_more";
  moreBtn.innerHTML = svg(ICONS.chevrons_right);
  titleUpdaters.push(() => {
    moreBtn.title = t("tb.more");
  });
  // タブ種別による表示制御クラス（CSSが body[data-tabkind] と組で出し分ける）。
  const visClass = (spec: ButtonSpec): string =>
    spec.vis === "editor"
      ? " toolbar-vis-editor"
      : spec.vis === "editorExport"
        ? " toolbar-vis-editorexport"
        : spec.vis === "hideSlideshow"
          ? " toolbar-vis-hideslideshow"
          : "";

  for (const spec of BUTTONS) {
    // プレゼン操作バーの差し込み口。
    if (spec.key === "pres_slot") {
      const slot = document.createElement("span");
      slot.className = "toolbar-pres-slot";
      slot.id = "toolbar-pres-slot";
      parent.appendChild(slot);
      continue;
    }
    // 最初に出現した右寄せ要素（sepでも可）の直前に、オーバーフロー「»」ボタンと
    // flex spacer を挿入して、以降を右端へ追いやる。
    if (spec.align === "right" && !spacerInserted) {
      parent.appendChild(moreBtn);
      const spacer = document.createElement("span");
      spacer.className = "toolbar-spacer";
      parent.appendChild(spacer);
      spacerInserted = true;
    }
    if (spec.key === "sep") {
      const sep = document.createElement("span");
      sep.className = "toolbar-sep" + visClass(spec);
      parent.appendChild(sep);
      if (!spacerInserted) collapsibles.push({ el: sep, spec });
      continue;
    }
    const btn = document.createElement("button");
    btn.className = "toolbar-btn" + visClass(spec);
    btn.title = t(spec.titleKey);
    btn.dataset.action = spec.key;
    btn.innerHTML = svg(spec.icon);
    // 文字色/ハイライトボタン: アイコン下に直近色のカラーバー、右下に▼バッジ。
    // クリック=直近色を適用、ホバー=パレットを開く。
    if (spec.key === "fmt_text_color" || spec.key === "fmt_highlight") {
      const bar = document.createElement("span");
      bar.className = "toolbar-colorbar";
      if (spec.key === "fmt_highlight") {
        bar.style.background = "var(--last-highlight-color, #ffff00)";
      }
      btn.appendChild(bar);
      const caret = document.createElement("span");
      caret.className = "toolbar-caret";
      btn.appendChild(caret);
      const menuAction =
        spec.key === "fmt_highlight" ? "fmt_highlight_menu" : "fmt_text_color_menu";
      wireHoverPopup(
        btn,
        () => actions[menuAction]?.(),
        getColorPaletteEl,
        closeColorPalette,
      );
    }
    // コールアウトボタン: ホバー/クリックで種類メニューを開く（右下に▼バッジ）。
    if (spec.key === "fmt_callout") {
      const caret = document.createElement("span");
      caret.className = "toolbar-caret";
      btn.appendChild(caret);
      wireHoverPopup(
        btn,
        () => actions.fmt_callout_menu?.(),
        getContextMenuEl,
        closeContextMenu,
      );
    }
    // 出力ボタン: ホバー/クリックで出力メニューを開く（右下に▼バッジ）。
    if (spec.key === "file_export_menu") {
      const caret = document.createElement("span");
      caret.className = "toolbar-caret";
      btn.appendChild(caret);
      wireHoverPopup(
        btn,
        () => openExportMenu(btn),
        getContextMenuEl,
        closeContextMenu,
      );
    }
    btn.addEventListener("mousedown", (e) => {
      // ボタンクリック時にエディタのフォーカスを失わないよう preventDefault
      e.preventDefault();
    });
    btn.addEventListener("click", (e) => {
      e.preventDefault();
      // 出力ボタンはアクションを持たず、メニューを開くだけ。
      if (spec.key === "file_export_menu") {
        if (!getContextMenuEl()) openExportMenu(btn);
        return;
      }
      const fn = actions[spec.key];
      if (fn) fn();
    });
    parent.appendChild(btn);
    if (!spacerInserted) collapsibles.push({ el: btn, spec });
    titleUpdaters.push(() => {
      btn.title = t(spec.titleKey);
    });
  }

  // ── オーバーフロー処理 ──
  // 狭いウィンドウでは左グループのボタンを末尾から隠し、「»」メニューへ逃がす。
  const fits = (): boolean => parent.scrollWidth <= parent.clientWidth + 1;
  const relayout = (): void => {
    for (const c of collapsibles) c.el.classList.remove("toolbar-overflow-hidden");
    moreBtn.classList.add("toolbar-overflow-hidden");
    if (fits()) return;
    moreBtn.classList.remove("toolbar-overflow-hidden");
    for (let i = collapsibles.length - 1; i >= 0 && !fits(); i--) {
      const c = collapsibles[i];
      // tabkind別のCSSで既に非表示のもの（プレゼンタブの書式ボタン等）は対象外。
      if (c.el.offsetParent === null) continue;
      c.el.classList.add("toolbar-overflow-hidden");
    }
  };

  moreBtn.addEventListener("mousedown", (e) => e.preventDefault());
  moreBtn.addEventListener("click", (e) => {
    e.preventDefault();
    // 隠れているボタンをリスト表示する。文字色/ハイライト/コールアウト/出力は
    // パレット・種類メニューを開くアクションに割り当てる（直接適用より選べる方が親切）。
    const menuActionOf = (key: string): (() => void) | undefined => {
      if (key === "fmt_text_color") return actions.fmt_text_color_menu;
      if (key === "fmt_highlight") return actions.fmt_highlight_menu;
      if (key === "fmt_callout") return actions.fmt_callout_menu;
      if (key === "file_export_menu") return () => openExportMenu(moreBtn);
      return actions[key];
    };
    const items: MenuItem[] = [];
    for (const c of collapsibles) {
      if (!c.el.classList.contains("toolbar-overflow-hidden")) continue;
      if (c.spec.key === "sep") {
        if (items.length > 0 && items[items.length - 1].type !== "separator") {
          items.push({ type: "separator" });
        }
        continue;
      }
      const fn = menuActionOf(c.spec.key);
      items.push({
        type: "item",
        label: t(c.spec.titleKey),
        icon: svg(c.spec.icon),
        action: () => fn?.(),
      });
    }
    if (items.length && items[items.length - 1].type === "separator") items.pop();
    if (!items.length) return;
    const r = moreBtn.getBoundingClientRect();
    showContextMenu(r.left, r.bottom + 2, items);
  });

  // 幅の変化・タブ種別の切替（表示ボタンが変わる）・言語切替で再計算する。
  const ro = new ResizeObserver(() => relayout());
  ro.observe(parent);
  new MutationObserver(() => relayout()).observe(document.body, {
    attributes: true,
    attributeFilter: ["data-tabkind"],
  });
  requestAnimationFrame(relayout);

  // 言語切替時にtooltipを更新
  onLangChange(() => {
    for (const fn of titleUpdaters) fn();
    relayout();
  });
}
