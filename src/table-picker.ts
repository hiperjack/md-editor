/**
 * 表挿入用の行列数グリッドピッカー（PowerPoint の「表の挿入」風）。
 *
 * 10列×8行のマス目を表示し、ホバーで左上からの範囲がハイライトされ、
 * 下のラベルに「3 × 4 の表」と行列数を出す。クリックで onPick(rows, cols) を呼ぶ。
 * 表示・閉じる仕組み（外側 mousedown / Esc / スクロール / リサイズ / blur、
 * mousedown 抑止によるエディタ選択の保持、画面端クランプ、フルスクリーン対応）
 * は color-palette.ts と同じ方式。
 */
import { t } from "./i18n";

export const TABLE_PICKER_COLS = 10;
export const TABLE_PICKER_ROWS = 8;

export type TableSize = { rows: number; cols: number };

/** マス目の通し番号（行優先・0 始まり）から 1 始まりの行列数を求める。 */
export function pickerCellFromIndex(index: number): TableSize {
  return {
    rows: Math.floor(index / TABLE_PICKER_COLS) + 1,
    cols: (index % TABLE_PICKER_COLS) + 1,
  };
}

/** (row, col) のマスが、ホバー中の範囲（左上から hover まで）に含まれるか。 */
export function isPickerCellHighlighted(
  row: number,
  col: number,
  hover: TableSize | null,
): boolean {
  if (!hover) return false;
  return row <= hover.rows && col <= hover.cols;
}

/** "{rows} × {cols} の表" のようなテンプレートに行列数を差し込む。 */
export function formatTableSizeLabel(template: string, size: TableSize): string {
  return template
    .replace("{rows}", String(size.rows))
    .replace("{cols}", String(size.cols));
}

let pickerEl: HTMLElement | null = null;
let cleanup: (() => void) | null = null;

/** 表示中のピッカー要素（未表示なら null）。ホバー開閉の判定に使う。 */
export function getTablePickerEl(): HTMLElement | null {
  return pickerEl;
}

export function closeTablePicker(): void {
  if (cleanup) {
    cleanup();
    cleanup = null;
  }
  if (pickerEl) {
    pickerEl.remove();
    pickerEl = null;
  }
}

/**
 * ピッカーを表示する。マスをクリックすると onPick(size) を呼ぶ。
 * 選択せず閉じた場合は onPick を呼ばない。
 */
export function showTablePicker(
  anchor: { x: number; y: number },
  onPick: (size: TableSize) => void,
): void {
  closeTablePicker();

  const pane = document.createElement("div");
  pane.className = "table-picker";

  const grid = document.createElement("div");
  grid.className = "table-picker__grid";
  grid.style.gridTemplateColumns = `repeat(${TABLE_PICKER_COLS}, 1fr)`;
  pane.appendChild(grid);

  const label = document.createElement("div");
  label.className = "table-picker__label";
  pane.appendChild(label);

  const cells: HTMLElement[] = [];
  const total = TABLE_PICKER_COLS * TABLE_PICKER_ROWS;

  const render = (hover: TableSize | null): void => {
    for (let i = 0; i < total; i++) {
      const { rows, cols } = pickerCellFromIndex(i);
      cells[i].classList.toggle(
        "is-active",
        isPickerCellHighlighted(rows, cols, hover),
      );
    }
    label.textContent = hover
      ? formatTableSizeLabel(t("table.pick.size"), hover)
      : t("table.pick.hint");
  };

  for (let i = 0; i < total; i++) {
    const cell = document.createElement("button");
    cell.type = "button";
    cell.className = "table-picker__cell";
    const size = pickerCellFromIndex(i);
    cell.addEventListener("mousedown", (e) => e.preventDefault());
    cell.addEventListener("mouseenter", () => render(size));
    cell.addEventListener("focus", () => render(size));
    cell.addEventListener("click", () => {
      closeTablePicker();
      onPick(size);
    });
    cells.push(cell);
    grid.appendChild(cell);
  }
  grid.addEventListener("mouseleave", () => render(null));
  render(null);

  presentPane(pane, anchor);
}

/** 共通表示処理（配置・クランプ・閉じるリスナ）。color-palette.ts と同じ。 */
function presentPane(pane: HTMLElement, anchor: { x: number; y: number }): void {
  pane.style.left = "0px";
  pane.style.top = "0px";
  pane.style.visibility = "hidden";
  const root = document.getElementById("app") ?? document.body;
  (document.fullscreenElement ?? root).appendChild(pane);
  pickerEl = pane;

  const w = pane.offsetWidth;
  const h = pane.offsetHeight;
  const left = Math.max(4, Math.min(anchor.x, window.innerWidth - w - 4));
  const top = Math.max(4, Math.min(anchor.y, window.innerHeight - h - 4));
  pane.style.left = `${left}px`;
  pane.style.top = `${top}px`;
  pane.style.visibility = "visible";

  const onPointerDown = (e: MouseEvent) => {
    if (pickerEl && !pickerEl.contains(e.target as Node)) closeTablePicker();
  };
  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key === "Escape") {
      e.preventDefault();
      closeTablePicker();
    }
  };
  const onClose = () => closeTablePicker();
  const onScroll = (ev: Event) => {
    if (pickerEl && ev.target instanceof Node && pickerEl.contains(ev.target))
      return;
    closeTablePicker();
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
