import { describe, it, expect } from "vitest";
import { shouldFlipPopupBelow, POPUP_SPACE_ABOVE } from "./table-handle-popup";

describe("shouldFlipPopupBelow", () => {
  it("ハンドル上端とエディタ領域上端の間に十分な余白があれば反転しない", () => {
    expect(shouldFlipPopupBelow(200, 100)).toBe(false);
    expect(shouldFlipPopupBelow(100 + POPUP_SPACE_ABOVE, 100)).toBe(false);
  });

  it("余白がポップアップの必要高さより小さいと反転する", () => {
    expect(shouldFlipPopupBelow(100 + POPUP_SPACE_ABOVE - 1, 100)).toBe(true);
    expect(shouldFlipPopupBelow(110, 100)).toBe(true);
  });

  it("ハンドルが領域より上（スクロールで隠れている）でも反転する", () => {
    expect(shouldFlipPopupBelow(50, 100)).toBe(true);
  });
});
