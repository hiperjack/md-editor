import { describe, it, expect } from "vitest";
import {
  TABLE_PICKER_COLS,
  TABLE_PICKER_ROWS,
  pickerCellFromIndex,
  isPickerCellHighlighted,
  formatTableSizeLabel,
} from "./table-picker";

describe("table-picker の純粋ロジック", () => {
  it("グリッドは PowerPoint と同じ 10列×8行", () => {
    expect(TABLE_PICKER_COLS).toBe(10);
    expect(TABLE_PICKER_ROWS).toBe(8);
  });

  it("セルの通し番号から 1 始まりの行・列を求める", () => {
    expect(pickerCellFromIndex(0)).toEqual({ rows: 1, cols: 1 });
    expect(pickerCellFromIndex(9)).toEqual({ rows: 1, cols: 10 });
    expect(pickerCellFromIndex(10)).toEqual({ rows: 2, cols: 1 });
    expect(pickerCellFromIndex(79)).toEqual({ rows: 8, cols: 10 });
  });

  it("ホバー位置の左上領域だけがハイライトされる", () => {
    const hover = { rows: 3, cols: 4 };
    expect(isPickerCellHighlighted(1, 1, hover)).toBe(true);
    expect(isPickerCellHighlighted(3, 4, hover)).toBe(true);
    expect(isPickerCellHighlighted(4, 1, hover)).toBe(false);
    expect(isPickerCellHighlighted(1, 5, hover)).toBe(false);
  });

  it("ホバーなしのときは何もハイライトされない", () => {
    expect(isPickerCellHighlighted(1, 1, null)).toBe(false);
  });

  it("ラベルは行 × 列 をテンプレートに差し込む", () => {
    expect(formatTableSizeLabel("{rows} × {cols} の表", { rows: 3, cols: 4 })).toBe(
      "3 × 4 の表",
    );
    expect(formatTableSizeLabel("{rows} × {cols} table", { rows: 8, cols: 10 })).toBe(
      "8 × 10 table",
    );
  });
});
