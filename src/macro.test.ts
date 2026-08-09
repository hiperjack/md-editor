import { describe, it, expect } from "vitest";
import {
  keyStepFromEvent,
  appendTextStep,
  serializeMacro,
  parseMacro,
  type MacroStep,
} from "./macro";

const ev = (
  key: string,
  mods: Partial<{ ctrl: boolean; shift: boolean; alt: boolean; meta: boolean; composing: boolean }> = {},
) => ({
  key,
  ctrlKey: !!mods.ctrl,
  shiftKey: !!mods.shift,
  altKey: !!mods.alt,
  metaKey: !!mods.meta,
  isComposing: !!mods.composing,
});

describe("keyStepFromEvent", () => {
  it("修飾なしの印字キーは null（beforeinput 側で記録するため）", () => {
    expect(keyStepFromEvent(ev("a"))).toBeNull();
    expect(keyStepFromEvent(ev("A", { shift: true }))).toBeNull();
    expect(keyStepFromEvent(ev(" "))).toBeNull();
    expect(keyStepFromEvent(ev("あ"))).toBeNull();
  });

  it("修飾キー単独は null", () => {
    expect(keyStepFromEvent(ev("Control", { ctrl: true }))).toBeNull();
    expect(keyStepFromEvent(ev("Shift", { shift: true }))).toBeNull();
    expect(keyStepFromEvent(ev("Alt", { alt: true }))).toBeNull();
  });

  it("IME変換中（isComposing / key=Process）は null", () => {
    expect(keyStepFromEvent(ev("a", { composing: true }))).toBeNull();
    expect(keyStepFromEvent(ev("Process"))).toBeNull();
  });

  it("マクロ操作キー自身（Shift+F1/F2）は null", () => {
    expect(keyStepFromEvent(ev("F1", { shift: true }))).toBeNull();
    expect(keyStepFromEvent(ev("F2", { shift: true }))).toBeNull();
  });

  it("ナビゲーション・編集キーはキーステップになる", () => {
    expect(keyStepFromEvent(ev("Enter"))).toEqual({
      type: "key", key: "Enter", ctrl: false, shift: false, alt: false,
    });
    expect(keyStepFromEvent(ev("ArrowDown"))).toEqual({
      type: "key", key: "ArrowDown", ctrl: false, shift: false, alt: false,
    });
    expect(keyStepFromEvent(ev("Home", { shift: true }))).toEqual({
      type: "key", key: "Home", ctrl: false, shift: true, alt: false,
    });
  });

  it("Ctrl/Meta 付きの印字キーはキーステップになる（Meta は ctrl に正規化）", () => {
    expect(keyStepFromEvent(ev("b", { ctrl: true }))).toEqual({
      type: "key", key: "b", ctrl: true, shift: false, alt: false,
    });
    expect(keyStepFromEvent(ev("b", { meta: true }))).toEqual({
      type: "key", key: "b", ctrl: true, shift: false, alt: false,
    });
  });
});

describe("appendTextStep", () => {
  it("空配列にはテキストステップを追加する", () => {
    const steps: MacroStep[] = [];
    appendTextStep(steps, "a");
    expect(steps).toEqual([{ type: "text", text: "a" }]);
  });

  it("末尾がテキストステップなら連結する", () => {
    const steps: MacroStep[] = [{ type: "text", text: "a" }];
    appendTextStep(steps, "bc");
    expect(steps).toEqual([{ type: "text", text: "abc" }]);
  });

  it("末尾がキーステップなら新規テキストステップを積む", () => {
    const steps: MacroStep[] = [
      { type: "text", text: "a" },
      { type: "key", key: "Enter", ctrl: false, shift: false, alt: false },
    ];
    appendTextStep(steps, "い");
    expect(steps).toHaveLength(3);
    expect(steps[2]).toEqual({ type: "text", text: "い" });
  });

  it("空文字は無視する", () => {
    const steps: MacroStep[] = [];
    appendTextStep(steps, "");
    expect(steps).toEqual([]);
  });
});

describe("serializeMacro / parseMacro", () => {
  const steps: MacroStep[] = [
    { type: "text", text: "- " },
    { type: "key", key: "ArrowDown", ctrl: false, shift: false, alt: false },
  ];

  it("roundtrip できる", () => {
    expect(parseMacro(serializeMacro(steps))).toEqual(steps);
  });

  it("ヘッダ（app/type/version）が不正なら null", () => {
    expect(parseMacro(JSON.stringify({ app: "other", type: "keyboard-macro", version: 1, steps: [] }))).toBeNull();
    expect(parseMacro(JSON.stringify({ app: "mdedit", type: "other", version: 1, steps: [] }))).toBeNull();
    expect(parseMacro(JSON.stringify({ app: "mdedit", type: "keyboard-macro", version: 2, steps: [] }))).toBeNull();
  });

  it("steps が配列でない・要素が不正なら null", () => {
    expect(parseMacro(JSON.stringify({ app: "mdedit", type: "keyboard-macro", version: 1, steps: {} }))).toBeNull();
    expect(parseMacro(JSON.stringify({ app: "mdedit", type: "keyboard-macro", version: 1, steps: [{ type: "text" }] }))).toBeNull();
    expect(parseMacro(JSON.stringify({ app: "mdedit", type: "keyboard-macro", version: 1, steps: [{ type: "key" }] }))).toBeNull();
  });

  it("JSONとして壊れていたら null", () => {
    expect(parseMacro("{not json")).toBeNull();
  });
});
