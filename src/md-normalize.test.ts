import { describe, it, expect } from "vitest";
import { ensureBlankLineBeforeTables } from "./md-normalize";

const TABLE = ["| a | b |", "| --- | --- |", "| 1 | 2 |"].join("\n");

describe("ensureBlankLineBeforeTables", () => {
  it("inserts a blank line between a bullet list item and a table", () => {
    const src = ["- item", TABLE].join("\n");
    expect(ensureBlankLineBeforeTables(src)).toBe(["- item", "", TABLE].join("\n"));
  });

  it("inserts a blank line between a numbered list item and a table", () => {
    const src = ["1. item", TABLE].join("\n");
    expect(ensureBlankLineBeforeTables(src)).toBe(
      ["1. item", "", TABLE].join("\n"),
    );
  });

  it("inserts a blank line between a paragraph and a table", () => {
    const src = ["text", TABLE].join("\n");
    expect(ensureBlankLineBeforeTables(src)).toBe(["text", "", TABLE].join("\n"));
  });

  it("leaves a table that already has a blank line before it untouched", () => {
    const src = ["text", "", TABLE].join("\n");
    expect(ensureBlankLineBeforeTables(src)).toBe(src);
  });

  it("does not touch table-like lines inside a fenced code block", () => {
    const src = ["```", "- item", TABLE, "```"].join("\n");
    expect(ensureBlankLineBeforeTables(src)).toBe(src);
  });

  it("does not insert when the preceding line is itself a table row", () => {
    // 既に表の途中（ヘッダ→区切り）には挿入しない
    const src = TABLE;
    expect(ensureBlankLineBeforeTables(src)).toBe(src);
  });

  it("ignores pipe-containing lines that are not followed by a delimiter row", () => {
    const src = ["- a | b", "- c | d"].join("\n");
    expect(ensureBlankLineBeforeTables(src)).toBe(src);
  });

  it("handles a real list-then-table case (reported bug)", () => {
    const src = [
      "- あいうえお",
      "| あああ | いいい | ううう |",
      "| :--- | :--- | :--- |",
      "| 良い | x | y |",
    ].join("\n");
    expect(ensureBlankLineBeforeTables(src)).toBe(
      [
        "- あいうえお",
        "",
        "| あああ | いいい | ううう |",
        "| :--- | :--- | :--- |",
        "| 良い | x | y |",
      ].join("\n"),
    );
  });
});
