/**
 * 文字色パレットのフローティングポップアップ。
 *
 * Word / Obsidian Editing Toolbar と同じ Office 配色の
 * 「テーマ色10列×濃淡6段 + 標準色10色 + 色を解除」を表示する。
 * 表示・閉じる仕組み（外側 mousedown / Esc / スクロール / リサイズ / blur、
 * mousedown 抑止によるエディタ選択の保持、画面端クランプ、フルスクリーン対応）
 * は context-menu.ts と同じ方式。
 */
import { t } from "./i18n";

/** テーマ色。行0が基本色、行1〜5が濃淡（Office 標準配色）。 */
const THEME_ROWS: readonly (readonly string[])[] = [
  ["#ffffff", "#000000", "#eeece1", "#1f497d", "#4f81bd", "#c0504d", "#9bbb59", "#8064a2", "#4bacc6", "#f79646"],
  ["#f2f2f2", "#7f7f7f", "#ddd9c3", "#c6d9f0", "#dbe5f1", "#f2dcdb", "#ebf1dd", "#e5e0ec", "#dbeef3", "#fdeada"],
  ["#d8d8d8", "#595959", "#c4bd97", "#8db3e2", "#b8cce4", "#e5b9b7", "#d7e3bc", "#ccc1d9", "#b7dde8", "#fbd5b5"],
  ["#bfbfbf", "#3f3f3f", "#938953", "#548dd4", "#95b3d7", "#d99694", "#c3d69b", "#b2a2c7", "#92cddc", "#fac08f"],
  ["#a5a5a5", "#262626", "#494429", "#17365d", "#366092", "#953734", "#76923c", "#5f497a", "#31859b", "#e36c09"],
  ["#7f7f7f", "#0c0c0c", "#1d1b10", "#0f243e", "#244061", "#632423", "#4f6128", "#3f3151", "#205867", "#974806"],
];

/** 標準色（Office 標準配色）。 */
const STANDARD_ROW: readonly string[] = [
  "#c00000", "#ff0000", "#ffc000", "#ffff00", "#92d050",
  "#00b050", "#00b0f0", "#0070c0", "#002060", "#7030a0",
];

/** ハイライト（蛍光マーカー）用のパステル10色。濃色文字が読める明度に揃える。 */
const HIGHLIGHT_ROW: readonly string[] = [
  "#fff59b", "#ffe066", "#d9f7a1", "#b5f2c8", "#b3f0f7",
  "#bcd9ff", "#dcc9ff", "#ffc9e8", "#ffc2c2", "#e3e6ea",
];

let paletteEl: HTMLElement | null = null;
let cleanup: (() => void) | null = null;

/** 表示中のパレット要素（未表示なら null）。ホバー開閉の判定に使う。 */
export function getColorPaletteEl(): HTMLElement | null {
  return paletteEl;
}

export function closeColorPalette(): void {
  if (cleanup) {
    cleanup();
    cleanup = null;
  }
  if (paletteEl) {
    paletteEl.remove();
    paletteEl = null;
  }
}

function addSwatchRow(
  grid: HTMLElement,
  colors: readonly string[],
  pick: (color: string) => void,
): void {
  for (const color of colors) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "color-palette__swatch";
    btn.style.background = color;
    btn.title = color;
    btn.addEventListener("mousedown", (e) => e.preventDefault());
    btn.addEventListener("click", () => pick(color));
    grid.appendChild(btn);
  }
}

/**
 * パレットを表示する。onPick は色（"#rrggbb"）または null（=色を解除）で呼ばれる。
 * 選択せず閉じた場合は onPick を呼ばない。
 */
export function showColorPalette(
  anchor: { x: number; y: number },
  onPick: (color: string | null) => void,
): void {
  closeColorPalette();

  const pane = document.createElement("div");
  pane.className = "color-palette";

  const pick = (color: string | null): void => {
    closeColorPalette();
    onPick(color);
  };

  const addHeading = (label: string): void => {
    const h = document.createElement("div");
    h.className = "color-palette__heading";
    h.textContent = label;
    pane.appendChild(h);
  };
  const addGrid = (rows: readonly (readonly string[])[]): void => {
    const grid = document.createElement("div");
    grid.className = "color-palette__grid";
    for (const row of rows) addSwatchRow(grid, row, pick);
    pane.appendChild(grid);
  };

  addHeading(t("color.theme"));
  addGrid(THEME_ROWS);
  addHeading(t("color.standard"));
  addGrid([STANDARD_ROW]);

  const clearBtn = document.createElement("button");
  clearBtn.type = "button";
  clearBtn.className = "color-palette__clear";
  clearBtn.textContent = t("color.clear");
  clearBtn.addEventListener("mousedown", (e) => e.preventDefault());
  clearBtn.addEventListener("click", () => pick(null));
  pane.appendChild(clearBtn);

  presentPane(pane, anchor);
}

/**
 * ハイライト（蛍光マーカー）用パレット。
 * onPick: "#rrggbb"=色付き / ""=標準マーカー（属性なし <mark>）/ null=解除。
 */
export function showHighlightPalette(
  anchor: { x: number; y: number },
  onPick: (color: string | null) => void,
): void {
  closeColorPalette();

  const pane = document.createElement("div");
  pane.className = "color-palette";

  const pick = (color: string | null): void => {
    closeColorPalette();
    onPick(color);
  };

  const heading = document.createElement("div");
  heading.className = "color-palette__heading";
  heading.textContent = t("color.highlight");
  pane.appendChild(heading);

  const grid = document.createElement("div");
  grid.className = "color-palette__grid";
  addSwatchRow(grid, HIGHLIGHT_ROW, pick);
  pane.appendChild(grid);

  const defaultBtn = document.createElement("button");
  defaultBtn.type = "button";
  defaultBtn.className = "color-palette__clear color-palette__mark-default";
  defaultBtn.textContent = t("color.markDefault");
  defaultBtn.addEventListener("mousedown", (e) => e.preventDefault());
  defaultBtn.addEventListener("click", () => pick(""));
  pane.appendChild(defaultBtn);

  const clearBtn = document.createElement("button");
  clearBtn.type = "button";
  clearBtn.className = "color-palette__clear";
  clearBtn.textContent = t("color.clear");
  clearBtn.addEventListener("mousedown", (e) => e.preventDefault());
  clearBtn.addEventListener("click", () => pick(null));
  pane.appendChild(clearBtn);

  presentPane(pane, anchor);
}

/** パレットの共通表示処理（配置・クランプ・閉じるリスナ）。 */
function presentPane(pane: HTMLElement, anchor: { x: number; y: number }): void {
  // サイズ測定のため一旦不可視で配置 → 画面端でクランプ（context-menu.ts と同じ）。
  pane.style.left = "0px";
  pane.style.top = "0px";
  pane.style.visibility = "hidden";
  const root = document.getElementById("app") ?? document.body;
  (document.fullscreenElement ?? root).appendChild(pane);
  paletteEl = pane;

  const w = pane.offsetWidth;
  const h = pane.offsetHeight;
  const left = Math.max(4, Math.min(anchor.x, window.innerWidth - w - 4));
  const top = Math.max(4, Math.min(anchor.y, window.innerHeight - h - 4));
  pane.style.left = `${left}px`;
  pane.style.top = `${top}px`;
  pane.style.visibility = "visible";

  const onPointerDown = (e: MouseEvent) => {
    if (paletteEl && !paletteEl.contains(e.target as Node)) closeColorPalette();
  };
  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key === "Escape") {
      e.preventDefault();
      closeColorPalette();
    }
  };
  const onClose = () => closeColorPalette();
  // パレット自身の内部スクロール（低いウィンドウでの max-height 超過時）では閉じない。
  const onScroll = (ev: Event) => {
    if (paletteEl && ev.target instanceof Node && paletteEl.contains(ev.target))
      return;
    closeColorPalette();
  };

  document.addEventListener("mousedown", onPointerDown, true);
  document.addEventListener("keydown", onKeyDown, true);
  window.addEventListener("scroll", onScroll, true);
  window.addEventListener("resize", onClose);
  window.addEventListener("blur", onClose);

  cleanup = () => {
    document.removeEventListener("mousedown", onPointerDown, true);
    document.removeEventListener("keydown", onKeyDown, true);
    window.removeEventListener("scroll", onScroll, true);
    window.removeEventListener("resize", onClose);
    window.removeEventListener("blur", onClose);
  };
}
