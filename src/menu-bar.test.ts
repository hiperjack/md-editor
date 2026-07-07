import { describe, it, expect } from "vitest";
import { mnemonicChar } from "./menu-bar";

describe("mnemonicChar", () => {
  it("英数キーは小文字に正規化して返す", () => {
    expect(mnemonicChar({ key: "a", code: "KeyA" })).toBe("a");
    expect(mnemonicChar({ key: "A", code: "KeyA" })).toBe("a");
    expect(mnemonicChar({ key: "5", code: "Digit5" })).toBe("5");
  });

  it("IME処理中（key=Process）は物理キー（code）から復元する", () => {
    expect(mnemonicChar({ key: "Process", code: "KeyA" })).toBe("a");
    expect(mnemonicChar({ key: "Process", code: "KeyH" })).toBe("h");
    expect(mnemonicChar({ key: "Process", code: "Digit3" })).toBe("3");
    expect(mnemonicChar({ key: "Unidentified", code: "KeyZ" })).toBe("z");
  });

  it("英数以外は null", () => {
    expect(mnemonicChar({ key: "Enter", code: "Enter" })).toBeNull();
    expect(mnemonicChar({ key: "Escape", code: "Escape" })).toBeNull();
    expect(mnemonicChar({ key: "F5", code: "F5" })).toBeNull();
    expect(mnemonicChar({ key: "Process", code: "Space" })).toBeNull();
    expect(mnemonicChar({ key: "あ", code: "KeyA" })).toBeNull();
  });
});
