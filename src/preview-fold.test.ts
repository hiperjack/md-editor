import { describe, it, expect } from "vitest";
import { headingLevelOf, computeHiddenFlags } from "./preview-fold";

describe("headingLevelOf", () => {
  it("maps H1..H6 to 1..6, others to 0", () => {
    expect(headingLevelOf("H1")).toBe(1);
    expect(headingLevelOf("H3")).toBe(3);
    expect(headingLevelOf("H6")).toBe(6);
    expect(headingLevelOf("P")).toBe(0);
    expect(headingLevelOf("DIV")).toBe(0);
  });
});

// 見やすさのためのヘルパ: [level, collapsed]
const items = (rows: [number, boolean][]) =>
  rows.map(([level, collapsed]) => ({ level, collapsed }));

describe("computeHiddenFlags", () => {
  it("hides content under a collapsed heading until same-or-higher heading", () => {
    // h1(collapsed), p, h2, p, h1
    const flags = computeHiddenFlags(
      items([
        [1, true],
        [0, false],
        [2, false],
        [0, false],
        [1, false],
      ]),
    );
    expect(flags).toEqual([false, true, true, true, false]);
  });

  it("ends the collapse range at a same-level heading", () => {
    // h2(collapsed), p, h2, p
    const flags = computeHiddenFlags(
      items([
        [2, true],
        [0, false],
        [2, false],
        [0, false],
      ]),
    );
    expect(flags).toEqual([false, true, false, false]);
  });

  it("handles nested collapses (outer hides inner heading too)", () => {
    // h1(collapsed), h2(collapsed), p, h1
    const flags = computeHiddenFlags(
      items([
        [1, true],
        [2, true],
        [0, false],
        [1, false],
      ]),
    );
    expect(flags).toEqual([false, true, true, false]);
  });

  it("keeps inner collapse when only inner is collapsed", () => {
    // h1, h2(collapsed), p, h2, p
    const flags = computeHiddenFlags(
      items([
        [1, false],
        [2, true],
        [0, false],
        [2, false],
        [0, false],
      ]),
    );
    expect(flags).toEqual([false, false, true, false, false]);
  });

  it("nothing hidden when no heading is collapsed", () => {
    const flags = computeHiddenFlags(
      items([
        [1, false],
        [0, false],
        [2, false],
        [0, false],
      ]),
    );
    expect(flags).toEqual([false, false, false, false]);
  });
});
