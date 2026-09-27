import { describe, it, expect } from "vitest";
import {
  ensureBlankLineBeforeTables,
  ensureBlankLineBeforeFootnoteDefs,
  wrapSpacedLinkDestinations,
  formatMarkdownDestination,
} from "./md-normalize";

describe("formatMarkdownDestination", () => {
  it("スペースを含むパスは <> で囲む", () => {
    expect(formatMarkdownDestination("img/My Image.png")).toBe("<img/My Image.png>");
  });
  it("スペースを含まないパス・%20 形式はそのまま", () => {
    expect(formatMarkdownDestination("img/a.png")).toBe("img/a.png");
    expect(formatMarkdownDestination("img/My%20Image.png")).toBe("img/My%20Image.png");
  });
  it("囲むときは中の < > をエスケープする", () => {
    expect(formatMarkdownDestination("a <b>.png")).toBe("<a \\<b\\>.png>");
  });
});

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

describe("ensureBlankLineBeforeFootnoteDefs", () => {
  it("段落直後の脚注定義の前に空行を補う", () => {
    const src = ["note[^1]", "[^1]: test"].join("\n");
    expect(ensureBlankLineBeforeFootnoteDefs(src)).toBe(
      ["note[^1]", "", "[^1]: test"].join("\n"),
    );
  });

  it("既に空行があれば何もしない", () => {
    const src = ["note[^1]", "", "[^1]: test"].join("\n");
    expect(ensureBlankLineBeforeFootnoteDefs(src)).toBe(src);
  });

  it("連続する定義の間には空行を入れない", () => {
    const src = ["note[^1][^2]", "[^1]: a", "[^2]: b"].join("\n");
    expect(ensureBlankLineBeforeFootnoteDefs(src)).toBe(
      ["note[^1][^2]", "", "[^1]: a", "[^2]: b"].join("\n"),
    );
  });

  it("コードフェンス内は対象外", () => {
    const src = ["```", "[^1]: code", "```"].join("\n");
    expect(ensureBlankLineBeforeFootnoteDefs(src)).toBe(src);
  });

  it("先頭行の定義はそのまま", () => {
    const src = ["[^1]: top", "body[^1]"].join("\n");
    expect(ensureBlankLineBeforeFootnoteDefs(src)).toBe(src);
  });
});

describe("wrapSpacedLinkDestinations", () => {
  const w = wrapSpacedLinkDestinations;

  it("リンク先に半角スペースがあれば <> で囲む", () => {
    expect(w("[B](https://example.com/a b)")).toBe("[B](<https://example.com/a b>)");
    expect(w("see [doc](my file.md) here")).toBe("see [doc](<my file.md>) here");
  });

  it("画像にも適用する", () => {
    expect(w("![alt](img/My Image.png)")).toBe("![alt](<img/My Image.png>)");
  });

  it("タイトル付きはリンク先だけを囲み、タイトルは残す", () => {
    expect(w('[a](my file.md "タイトル 付き")')).toBe('[a](<my file.md> "タイトル 付き")');
    expect(w("[a](my file.md 'single')")).toBe("[a](<my file.md> 'single')");
  });

  it("スペースがタイトルの区切りだけなら変更しない", () => {
    const src = '[a](https://example.com "title with spaces")';
    expect(w(src)).toBe(src);
  });

  it("既に <> 形式・%20 形式・スペースなしは変更しない", () => {
    for (const src of [
      "[a](<my file.md>)",
      "[a](my%20file.md)",
      "[a](https://example.com/x)",
    ]) {
      expect(w(src)).toBe(src);
    }
  });

  it("括弧を含むリンク先も対応する", () => {
    expect(w("[w](https://example.com/A_(B) c)")).toBe(
      "[w](<https://example.com/A_(B) c>)",
    );
  });

  it("括弧タイトル（CommonMark で有効）は変更しない", () => {
    const src = "[w](https://example.com/A (B))";
    expect(w(src)).toBe(src);
  });

  it("1 行に複数あってもそれぞれ処理する", () => {
    expect(w("[a](x y) and [b](p q)")).toBe("[a](<x y>) and [b](<p q>)");
  });

  it("コードスパンとフェンス内は変更しない", () => {
    expect(w("`[a](x y)` と [b](p q)")).toBe("`[a](x y)` と [b](<p q>)");
    const fenced = ["```", "[a](x y)", "```"].join("\n");
    expect(w(fenced)).toBe(fenced);
  });

  it("対応する [ が無い ](...) は変更しない", () => {
    const src = "f](x y)";
    expect(w(src)).toBe(src);
  });

  it("閉じ括弧が無い場合は変更しない", () => {
    const src = "[a](x y";
    expect(w(src)).toBe(src);
  });
});
