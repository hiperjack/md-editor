import { describe, it, expect } from "vitest";
import { findBarKeyAction } from "./find-bar-keys";

type KeyEv = Parameters<typeof findBarKeyAction>[0];

const ev = (over: Partial<KeyEv>): KeyEv => ({
  key: "",
  code: "",
  altKey: false,
  ctrlKey: false,
  metaKey: false,
  shiftKey: false,
  ...over,
});

describe("findBarKeyAction: Alt+R / Alt+A", () => {
  it("置換行が表示中の Alt+R は replace", () => {
    expect(
      findBarKeyAction(ev({ key: "r", code: "KeyR", altKey: true }), {
        replaceVisible: true,
        focus: "other",
      }),
    ).toBe("replace");
  });

  it("置換行が表示中の Alt+A は replaceAll", () => {
    expect(
      findBarKeyAction(ev({ key: "a", code: "KeyA", altKey: true }), {
        replaceVisible: true,
        focus: "other",
      }),
    ).toBe("replaceAll");
  });

  it("IME 全角モード（key=Process）でも物理キーから判定する", () => {
    expect(
      findBarKeyAction(ev({ key: "Process", code: "KeyR", altKey: true }), {
        replaceVisible: true,
        focus: "find",
      }),
    ).toBe("replace");
  });

  it("置換行が非表示なら Alt+R / Alt+A は無視する", () => {
    const opts = { replaceVisible: false, focus: "find" as const };
    expect(findBarKeyAction(ev({ key: "r", code: "KeyR", altKey: true }), opts)).toBeNull();
    expect(findBarKeyAction(ev({ key: "a", code: "KeyA", altKey: true }), opts)).toBeNull();
  });

  it("Ctrl や Meta が同時押しなら無視する", () => {
    const opts = { replaceVisible: true, focus: "find" as const };
    expect(
      findBarKeyAction(ev({ key: "r", code: "KeyR", altKey: true, ctrlKey: true }), opts),
    ).toBeNull();
    expect(
      findBarKeyAction(ev({ key: "a", code: "KeyA", altKey: true, metaKey: true }), opts),
    ).toBeNull();
  });

  it("Alt なしの r / a は無視する", () => {
    const opts = { replaceVisible: true, focus: "find" as const };
    expect(findBarKeyAction(ev({ key: "r", code: "KeyR" }), opts)).toBeNull();
  });
});

describe("findBarKeyAction: Tab 移動", () => {
  it("検索欄で Tab を押すと置換欄へ移動する", () => {
    expect(
      findBarKeyAction(ev({ key: "Tab", code: "Tab" }), {
        replaceVisible: true,
        focus: "find",
      }),
    ).toBe("focusReplace");
  });

  it("置換欄で Shift+Tab を押すと検索欄へ戻る", () => {
    expect(
      findBarKeyAction(ev({ key: "Tab", code: "Tab", shiftKey: true }), {
        replaceVisible: true,
        focus: "replace",
      }),
    ).toBe("focusFind");
  });

  it("置換行が非表示なら Tab は既定動作に任せる", () => {
    expect(
      findBarKeyAction(ev({ key: "Tab", code: "Tab" }), {
        replaceVisible: false,
        focus: "find",
      }),
    ).toBeNull();
  });

  it("検索欄の Shift+Tab と置換欄の Tab は既定動作に任せる", () => {
    expect(
      findBarKeyAction(ev({ key: "Tab", code: "Tab", shiftKey: true }), {
        replaceVisible: true,
        focus: "find",
      }),
    ).toBeNull();
    expect(
      findBarKeyAction(ev({ key: "Tab", code: "Tab" }), {
        replaceVisible: true,
        focus: "replace",
      }),
    ).toBeNull();
  });

  it("入力欄以外にフォーカスがあるときの Tab は既定動作に任せる", () => {
    expect(
      findBarKeyAction(ev({ key: "Tab", code: "Tab" }), {
        replaceVisible: true,
        focus: "other",
      }),
    ).toBeNull();
  });
});
