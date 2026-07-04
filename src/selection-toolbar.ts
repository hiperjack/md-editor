/**
 * 選択時ポップアップツールバー（バブルメニュー）。
 *
 * エディタ本文（WYSIWYG）でテキストを選択すると、選択範囲の上に主要書式
 * ボタンの小型バーを表示する。上部ツールバーまでマウスを往復せずに
 * 書式を適用できる（Word / Notion 風）。
 *
 *  - 表示条件: アクティブな Milkdown エディタ内のテキスト選択
 *    （画像ノード選択・ソースモード・プレビューの選択では出さない）。
 *  - ドラッグ選択中は出さず、mouseup 後に表示する。
 *  - ボタン: 太字 / 斜体 / 下線 / 文字色 / ハイライト / 取り消し線 / 書式クリア。
 *    文字色・ハイライトは上部ツールバー同様「クリック=直近色、ホバー=パレット」。
 */
import { NodeSelection } from "@milkdown/kit/prose/state";
import type { EditorHost } from "./editor";
import {
  ICONS,
  svg,
  wireHoverPopup,
  openTextColorPaletteAt,
  openHighlightPaletteAt,
} from "./toolbar";
import { getColorPaletteEl, closeColorPalette } from "./color-palette";
import { t, onLangChange } from "./i18n";

type Actions = Record<string, () => void>;

/** バーに載せるボタン（キーは toolbar のアクション名と共通）。 */
const BAR_BUTTONS: { key: string; icon: string; titleKey: string }[] = [
  { key: "fmt_bold", icon: ICONS.bold, titleKey: "tb.bold" },
  { key: "fmt_italic", icon: ICONS.italic, titleKey: "tb.italic" },
  { key: "fmt_underline", icon: ICONS.underline, titleKey: "tb.underline" },
  { key: "fmt_text_color", icon: ICONS.text_color, titleKey: "tb.textColor" },
  { key: "fmt_highlight", icon: ICONS.highlight, titleKey: "tb.highlight" },
  { key: "fmt_strike", icon: ICONS.strike, titleKey: "tb.strike" },
  { key: "fmt_clear", icon: ICONS.eraser, titleKey: "tb.clearFormat" },
];

/**
 * 選択時ポップアップツールバーを組み立てて配線する。main.ts が起動時に1回呼ぶ。
 */
export function installSelectionToolbar(
  editor: EditorHost,
  actions: Actions,
): void {
  const bar = document.createElement("div");
  bar.className = "selection-toolbar";
  bar.style.display = "none";
  (document.getElementById("app") ?? document.body).appendChild(bar);

  const titleUpdaters: Array<() => void> = [];
  for (const spec of BAR_BUTTONS) {
    const btn = document.createElement("button");
    btn.className = "toolbar-btn";
    btn.dataset.action = spec.key;
    btn.title = t(spec.titleKey);
    btn.innerHTML = svg(spec.icon);
    titleUpdaters.push(() => {
      btn.title = t(spec.titleKey);
    });
    // 文字色/ハイライトは直近色バー＋▼、ホバーでパレット（バーのボタン位置に開く）。
    if (spec.key === "fmt_text_color" || spec.key === "fmt_highlight") {
      const colorBar = document.createElement("span");
      colorBar.className = "toolbar-colorbar";
      if (spec.key === "fmt_highlight") {
        colorBar.style.background = "var(--last-highlight-color, #ffff00)";
      }
      btn.appendChild(colorBar);
      const caret = document.createElement("span");
      caret.className = "toolbar-caret";
      btn.appendChild(caret);
      const openPalette = (): void => {
        const r = btn.getBoundingClientRect();
        const anchor = { x: r.left, y: r.bottom + 4 };
        if (spec.key === "fmt_text_color") openTextColorPaletteAt(editor, anchor);
        else openHighlightPaletteAt(editor, anchor);
      };
      wireHoverPopup(btn, openPalette, getColorPaletteEl, closeColorPalette);
    }
    btn.addEventListener("mousedown", (e) => e.preventDefault());
    btn.addEventListener("click", (e) => {
      e.preventDefault();
      actions[spec.key]?.();
    });
    bar.appendChild(btn);
  }
  onLangChange(() => {
    for (const fn of titleUpdaters) fn();
  });

  const hide = (): void => {
    bar.style.display = "none";
  };

  let mouseSelecting = false;
  let updateTimer: number | null = null;

  const update = (): void => {
    if (mouseSelecting) return;
    const view = editor.getActiveView();
    const domSel = window.getSelection();
    if (!view || !domSel || domSel.isCollapsed || domSel.rangeCount === 0) {
      hide();
      return;
    }
    // エディタ本文内の選択に限る（ソースモード・プレビュー・検索バー等を除外）。
    if (!view.dom.contains(domSel.anchorNode)) {
      hide();
      return;
    }
    const sel = view.state.selection;
    if (sel.empty || sel instanceof NodeSelection) {
      hide();
      return;
    }

    // 測定のため一旦不可視で表示してサイズを取る。
    bar.style.visibility = "hidden";
    bar.style.display = "flex";
    const w = bar.offsetWidth;
    const h = bar.offsetHeight;

    const a = view.coordsAtPos(sel.from);
    const b = view.coordsAtPos(sel.to);
    const centerX = (a.left + b.right) / 2;
    const left = Math.max(4, Math.min(centerX - w / 2, window.innerWidth - w - 4));
    // 基本は選択範囲の上。入りきらなければ下に出す。
    let top = Math.min(a.top, b.top) - h - 8;
    if (top < 4) top = Math.max(a.bottom, b.bottom) + 8;
    bar.style.left = `${left}px`;
    bar.style.top = `${top}px`;
    bar.style.visibility = "visible";
  };

  const scheduleUpdate = (delay = 180): void => {
    if (updateTimer !== null) clearTimeout(updateTimer);
    updateTimer = window.setTimeout(update, delay);
  };

  // 選択の変化で表示・追従する（ドラッグ中は mouseup まで保留）。
  document.addEventListener("selectionchange", () => scheduleUpdate());
  document.addEventListener(
    "mousedown",
    (e) => {
      // バー自身の操作では選択を保持しつつ表示も保つ。
      if (bar.contains(e.target as Node)) return;
      const view = editor.getActiveView();
      if (view && view.dom.contains(e.target as Node)) {
        mouseSelecting = true;
      }
      hide();
    },
    true,
  );
  document.addEventListener(
    "mouseup",
    () => {
      if (!mouseSelecting) return;
      mouseSelecting = false;
      scheduleUpdate(10);
    },
    true,
  );
  // スクロールで座標がずれるため追従（バー上のパレット操作等は影響なし）。
  window.addEventListener(
    "scroll",
    () => {
      if (bar.style.display !== "none") scheduleUpdate(50);
    },
    true,
  );
  window.addEventListener("resize", hide);
  window.addEventListener("blur", hide);
}
