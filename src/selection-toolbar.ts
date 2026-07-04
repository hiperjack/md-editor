/**
 * 選択時ポップアップツールバー（ミニ書式バー）。
 *
 * テキストを選択して右クリックしたときだけ、右クリック位置の上に主要書式
 * ボタンの小型バーを表示する（Word のミニツールバー方式。コンテキスト
 * メニューと縦に並ぶ）。選択しただけでは表示しない。
 *
 *  - 呼び出し: editor-context-menu.ts が右クリック時に showAt(x, y) を呼ぶ。
 *  - ボタン: 太字 / 斜体 / 下線 / 文字色 / ハイライト / 取り消し線 / 書式クリア。
 *    文字色・ハイライトは上部ツールバー同様「クリック=直近色、ホバー=パレット」。
 *  - 非表示: バー外の mousedown / Esc / スクロール / 選択解除 / リサイズ / blur。
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

export type SelectionToolbarController = {
  /** 右クリック位置の上にバーを表示する（テキスト選択が無ければ何もしない）。 */
  showAt(x: number, y: number): void;
  hide(): void;
};

/** バーに載せるボタン（キーは toolbar のアクション名と共通）。 */
const BAR_BUTTONS: { key: string; icon: string; titleKey: string }[] = [
  { key: "fmt_bold", icon: ICONS.bold, titleKey: "tb.bold" },
  { key: "fmt_italic", icon: ICONS.italic, titleKey: "tb.italic" },
  { key: "fmt_underline", icon: ICONS.underline, titleKey: "tb.underline" },
  { key: "fmt_text_color", icon: ICONS.text_color, titleKey: "tb.textColor" },
  { key: "fmt_highlight", icon: ICONS.highlight, titleKey: "tb.highlight" },
  { key: "fmt_strike", icon: ICONS.strike, titleKey: "tb.strike" },
  { key: "fmt_link", icon: ICONS.link, titleKey: "tb.link" },
  { key: "fmt_clear", icon: ICONS.eraser, titleKey: "tb.clearFormat" },
];

/**
 * ミニ書式バーを組み立てて配線する。main.ts が起動時に1回呼び、
 * 返るコントローラを右クリックメニュー（editor-context-menu.ts）へ渡す。
 */
export function installSelectionToolbar(
  editor: EditorHost,
  actions: Actions,
): SelectionToolbarController {
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

  const showAt = (x: number, y: number): void => {
    const view = editor.getActiveView();
    if (!view) return;
    const sel = view.state.selection;
    if (sel.empty || sel instanceof NodeSelection) return;

    // 測定のため一旦不可視で表示してサイズを取り、右クリック位置の上に出す
    // （下に開くコンテキストメニューと縦に並ぶ）。上に入らなければ下へ。
    bar.style.visibility = "hidden";
    bar.style.display = "flex";
    const w = bar.offsetWidth;
    const h = bar.offsetHeight;
    const left = Math.max(4, Math.min(x, window.innerWidth - w - 4));
    let top = y - h - 10;
    if (top < 4) top = Math.min(y + 24, window.innerHeight - h - 4);
    bar.style.left = `${left}px`;
    bar.style.top = `${top}px`;
    bar.style.visibility = "visible";
  };

  // バー外の mousedown で閉じる（バー上は選択保持のため preventDefault 済み）。
  document.addEventListener(
    "mousedown",
    (e) => {
      if (!bar.contains(e.target as Node)) hide();
    },
    true,
  );
  document.addEventListener(
    "keydown",
    (e) => {
      if (e.key === "Escape") hide();
    },
    true,
  );
  // 選択が解除されたら閉じる（Delete やカーソル移動など）。
  document.addEventListener("selectionchange", () => {
    if (bar.style.display === "none") return;
    const domSel = window.getSelection();
    if (!domSel || domSel.isCollapsed) hide();
  });
  // 画面スクロールで閉じる（バー内・パレット内のスクロールは無視）。
  window.addEventListener(
    "scroll",
    (e) => {
      if (bar.style.display === "none") return;
      const target = e.target;
      if (target instanceof Node && bar.contains(target)) return;
      const palette = getColorPaletteEl();
      if (palette && target instanceof Node && palette.contains(target)) return;
      hide();
    },
    true,
  );
  window.addEventListener("resize", hide);
  window.addEventListener("blur", hide);

  return { showAt, hide };
}
