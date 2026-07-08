import { describe, it, expect } from "vitest";
import { scanFootnoteTokens } from "./footnote-pair";

describe("scanFootnoteTokens", () => {
  it("文中の [^label] を参照として検出する", () => {
    expect(scanFootnoteTokens("本文[^1]です")).toEqual([
      { kind: "ref", label: "1", from: 2, to: 6 },
    ]);
  });

  it("行頭の [^label]: を定義として検出する（to は : を含む）", () => {
    expect(scanFootnoteTokens("[^1]: メモ")).toEqual([
      { kind: "def", label: "1", from: 0, to: 5 },
    ]);
  });

  it("hardbreak（\\n）直後も行頭扱いで定義になる", () => {
    expect(scanFootnoteTokens("本文[^a]\n[^a]: メモ")).toEqual([
      { kind: "ref", label: "a", from: 2, to: 6 },
      { kind: "def", label: "a", from: 7, to: 12 },
    ]);
  });

  it("行中の [^1]: は参照扱い（: はトークン外）", () => {
    expect(scanFootnoteTokens("見よ[^1]: これ")).toEqual([
      { kind: "ref", label: "1", from: 2, to: 6 },
    ]);
  });

  it("行頭でも : が続かなければ参照", () => {
    expect(scanFootnoteTokens("[^1] だけ")).toEqual([
      { kind: "ref", label: "1", from: 0, to: 4 },
    ]);
  });

  it("エスケープ \\[^1] は無視、\\\\[^1] は有効", () => {
    expect(scanFootnoteTokens("\\[^1]")).toEqual([]);
    expect(scanFootnoteTokens("\\\\[^1]")).toEqual([
      { kind: "ref", label: "1", from: 2, to: 6 },
    ]);
  });

  it("ラベルに空白・] は含められない", () => {
    expect(scanFootnoteTokens("[^a b]")).toEqual([]);
    expect(scanFootnoteTokens("[^]")).toEqual([]);
  });

  it("空白埋め（コード・アトム相当）の部分はトークンにならない", () => {
    // インラインコード「`[^1]`」は呼び出し側で全て半角スペースに置換されて渡る想定
    expect(scanFootnoteTokens("      ")).toEqual([]);
    expect(scanFootnoteTokens("   [^1] ")).toEqual([
      { kind: "ref", label: "1", from: 3, to: 7 },
    ]);
  });

  it("複数トークンをすべて検出する", () => {
    expect(scanFootnoteTokens("a[^1]b[^2]c")).toEqual([
      { kind: "ref", label: "1", from: 1, to: 5 },
      { kind: "ref", label: "2", from: 6, to: 10 },
    ]);
  });
});
