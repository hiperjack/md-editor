import { describe, it, expect } from "vitest";
import { resolveReplacement } from "./search-core";

const m = (match: string, groups: string[] = []) => ({ match, groups });

describe("resolveReplacement", () => {
  it("非regexモードでは置換文字列をそのまま返す", () => {
    expect(resolveReplacement(m(","), "\\n", false)).toBe("\\n");
  });

  it("regexモードで \\n を実改行に展開する", () => {
    expect(resolveReplacement(m(","), "\\n", true)).toBe("\n");
  });

  it("regexモードで \\t \\r を展開する", () => {
    expect(resolveReplacement(m("x"), "a\\tb\\rc", true)).toBe("a\tb\rc");
  });

  it("\\\\ はリテラルのバックスラッシュ1個になる", () => {
    expect(resolveReplacement(m("x"), "\\\\n", true)).toBe("\\n");
  });

  it("未知のエスケープはバックスラッシュを落として文字を残す", () => {
    expect(resolveReplacement(m("x"), "\\q", true)).toBe("q");
  });

  it("キャプチャ参照 $1 と $& を展開する", () => {
    expect(resolveReplacement(m("ab", ["a", "b"]), "$2$1", true)).toBe("ba");
    expect(resolveReplacement(m("ab", ["a"]), "[$&]", true)).toBe("[ab]");
  });

  it("$$ はリテラルの $ になる", () => {
    expect(resolveReplacement(m("x"), "$$1", true)).toBe("$1");
  });

  it("キャプチャ文字列内のバックスラッシュを二重解釈しない", () => {
    // $1 が 'a\n' を返しても、後段で \n を改行に化けさせない
    expect(resolveReplacement(m("x", ["a\\n"]), "$1", true)).toBe("a\\n");
  });

  it("エスケープとキャプチャを混在できる", () => {
    expect(resolveReplacement(m("x", ["V"]), "$1\\nend", true)).toBe("V\nend");
  });
});
