import { describe, it, expect } from "vitest";
import {
  NBSP,
  INDENT_NBSP,
  countLeadingNbsp,
  indentLevel,
  formatImageAlt,
  parseImageAlt,
  composeImageAlt,
} from "./image-row";

describe("parseImageAlt", () => {
  it("「代替テキスト|幅」を分解する", () => {
    expect(parseImageAlt("説明|300")).toEqual({ text: "説明", width: 300 });
    expect(parseImageAlt("a photo | 320 ")).toEqual({ text: "a photo", width: 320 });
  });
  it("数値だけなら幅（従来形式）", () => {
    expect(parseImageAlt("300")).toEqual({ text: "", width: 300 });
    expect(parseImageAlt("|300")).toEqual({ text: "", width: 300 });
    expect(parseImageAlt("320.6")).toEqual({ text: "", width: 321 });
  });
  it("閾値以下の幅は未設定扱い", () => {
    expect(parseImageAlt("1.00")).toEqual({ text: "", width: 0 });
    expect(parseImageAlt("説明|5")).toEqual({ text: "説明", width: 0 });
  });
  it("パイプの後ろが数値でなければ全体を代替テキストとみなす", () => {
    expect(parseImageAlt("A|B")).toEqual({ text: "A|B", width: 0 });
    expect(parseImageAlt("説明")).toEqual({ text: "説明", width: 0 });
    expect(parseImageAlt(null)).toEqual({ text: "", width: 0 });
  });
});

describe("composeImageAlt", () => {
  it("代替テキストと幅を「テキスト|幅」にまとめる", () => {
    expect(composeImageAlt("説明", 300)).toBe("説明|300");
  });
  it("片方だけのときはその値だけ", () => {
    expect(composeImageAlt("", 300)).toBe("300");
    expect(composeImageAlt("説明", 0)).toBe("説明");
    expect(composeImageAlt("", 0)).toBe("");
  });
  it("幅は整数に丸め、閾値以下は出さない", () => {
    expect(composeImageAlt("説明", 320.4)).toBe("説明|320");
    expect(composeImageAlt("説明", 8)).toBe("説明");
  });
});

describe("countLeadingNbsp", () => {
  it("counts leading NBSP only", () => {
    expect(countLeadingNbsp(NBSP + NBSP + "x" + NBSP)).toBe(2);
    expect(countLeadingNbsp("x")).toBe(0);
    expect(countLeadingNbsp("")).toBe(0);
  });
});

describe("indentLevel", () => {
  it("divides leading NBSP by INDENT_NBSP, floored", () => {
    expect(indentLevel(NBSP.repeat(INDENT_NBSP))).toBe(1);
    expect(indentLevel(NBSP.repeat(INDENT_NBSP * 2 + 1))).toBe(2);
    expect(indentLevel(NBSP.repeat(INDENT_NBSP - 1))).toBe(0);
  });
});

describe("formatImageAlt", () => {
  it("treats finite-number alt over threshold as px width (rounded)", () => {
    expect(formatImageAlt("320")).toBe("320");
    expect(formatImageAlt("320.6")).toBe("321");
  });
  it("clears small/legacy numeric alt to empty", () => {
    expect(formatImageAlt("1")).toBe("");
    expect(formatImageAlt("10")).toBe("");
  });
  it("keeps 「代替テキスト|幅」 and normalizes the width", () => {
    expect(formatImageAlt("photo|320")).toBe("photo|320");
    expect(formatImageAlt("photo|320.6")).toBe("photo|321");
    expect(formatImageAlt("|320")).toBe("320");
  });
  it("keeps non-numeric alt as-is", () => {
    expect(formatImageAlt("photo")).toBe("photo");
    expect(formatImageAlt(null)).toBe("");
    expect(formatImageAlt(undefined)).toBe("");
  });
});
