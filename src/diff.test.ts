import { describe, it, expect } from "vitest";
import { diffLines, foldContext, type DiffLine } from "./diff";

/** 検証しやすいように "kind:text" の配列へ変換する。 */
function fmt(lines: DiffLine[] | null): string[] | null {
  if (lines === null) return null;
  return lines.map((l) => `${l.kind}:${l.text}`);
}

describe("diffLines", () => {
  it("同一文書は全行 same", () => {
    expect(fmt(diffLines("a\nb\nc", "a\nb\nc"))).toEqual([
      "same:a",
      "same:b",
      "same:c",
    ]);
  });

  it("行の追加を検出する", () => {
    expect(fmt(diffLines("a\nc", "a\nb\nc"))).toEqual([
      "same:a",
      "add:b",
      "same:c",
    ]);
  });

  it("行の削除を検出する", () => {
    expect(fmt(diffLines("a\nb\nc", "a\nc"))).toEqual([
      "same:a",
      "del:b",
      "same:c",
    ]);
  });

  it("行の変更は del + add になる", () => {
    const out = diffLines("a\nb\nc", "a\nB\nc");
    expect(out).not.toBeNull();
    const kinds = out!.map((l) => l.kind);
    expect(kinds.filter((k) => k === "del")).toHaveLength(1);
    expect(kinds.filter((k) => k === "add")).toHaveLength(1);
    expect(out!.find((l) => l.kind === "del")!.text).toBe("b");
    expect(out!.find((l) => l.kind === "add")!.text).toBe("B");
  });

  it("空文書からの追加は全行 add", () => {
    expect(fmt(diffLines("", "a\nb"))).toEqual(["add:a", "add:b"]);
  });

  it("全削除は全行 del", () => {
    expect(fmt(diffLines("a\nb", ""))).toEqual(["del:a", "del:b"]);
  });

  it("末尾改行の有無だけの違いは差分にしない", () => {
    expect(fmt(diffLines("a\nb\n", "a\nb"))).toEqual(["same:a", "same:b"]);
  });

  it("複数箇所の変更（先頭・中間・末尾の共通部分を保持）", () => {
    const oldText = "h1\nkeep1\nold-mid\nkeep2\nold-end";
    const newText = "h1\nkeep1\nnew-mid\nkeep2\nnew-end";
    const out = fmt(diffLines(oldText, newText))!;
    expect(out).toContain("same:keep1");
    expect(out).toContain("same:keep2");
    expect(out).toContain("del:old-mid");
    expect(out).toContain("add:new-mid");
    expect(out).toContain("del:old-end");
    expect(out).toContain("add:new-end");
  });

  it("差分が大きすぎる場合は null（全文置換フォールバック）", () => {
    const oldText = Array.from({ length: 2000 }, (_, i) => `old-${i}`).join("\n");
    const newText = Array.from({ length: 2000 }, (_, i) => `new-${i}`).join("\n");
    expect(diffLines(oldText, newText)).toBeNull();
  });

  it("diffを適用した結果がnewTextの行と一致する（復元性）", () => {
    const oldText = "a\nb\nc\nd\ne";
    const newText = "a\nx\nc\ny\ne\nz";
    const out = diffLines(oldText, newText)!;
    const rebuilt = out
      .filter((l) => l.kind === "same" || l.kind === "add")
      .map((l) => l.text);
    expect(rebuilt).toEqual(["a", "x", "c", "y", "e", "z"]);
    const original = out
      .filter((l) => l.kind === "same" || l.kind === "del")
      .map((l) => l.text);
    expect(original).toEqual(["a", "b", "c", "d", "e"]);
  });
});

describe("foldContext", () => {
  const same = (t: string): DiffLine => ({ kind: "same", text: t });
  const add = (t: string): DiffLine => ({ kind: "add", text: t });

  it("長い same 連続を skip に畳む（前後 context 行は残す）", () => {
    const lines: DiffLine[] = [
      add("x"),
      same("1"),
      same("2"),
      same("3"),
      same("4"),
      same("5"),
      same("6"),
      add("y"),
    ];
    const out = foldContext(lines, 2);
    expect(out.map((l) => `${l.kind}:${l.text}`)).toEqual([
      "add:x",
      "same:1",
      "same:2",
      "skip:… 2 …",
      "same:5",
      "same:6",
      "add:y",
    ]);
  });

  it("短い same 連続はそのまま", () => {
    const lines: DiffLine[] = [add("x"), same("1"), same("2"), add("y")];
    expect(foldContext(lines, 2)).toEqual(lines);
  });

  it("先頭の same 連続は末尾 context 行だけ残す", () => {
    const lines: DiffLine[] = [
      same("1"),
      same("2"),
      same("3"),
      same("4"),
      same("5"),
      add("x"),
    ];
    const out = foldContext(lines, 2);
    expect(out.map((l) => `${l.kind}:${l.text}`)).toEqual([
      "skip:… 3 …",
      "same:4",
      "same:5",
      "add:x",
    ]);
  });

  it("末尾の same 連続は先頭 context 行だけ残す", () => {
    const lines: DiffLine[] = [
      add("x"),
      same("1"),
      same("2"),
      same("3"),
      same("4"),
      same("5"),
    ];
    const out = foldContext(lines, 2);
    expect(out.map((l) => `${l.kind}:${l.text}`)).toEqual([
      "add:x",
      "same:1",
      "same:2",
      "skip:… 3 …",
    ]);
  });
});
