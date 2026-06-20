import { describe, it, expect } from "vitest";
import {
  NBSP,
  INDENT_NBSP,
  countLeadingNbsp,
  indentLevel,
  formatImageAlt,
} from "./image-row";

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
  it("keeps non-numeric alt as-is", () => {
    expect(formatImageAlt("photo")).toBe("photo");
    expect(formatImageAlt(null)).toBe("");
    expect(formatImageAlt(undefined)).toBe("");
  });
});
