import { describe, it, expect } from "vitest";
import {
  splitFrontmatter,
  parseFrontmatterRows,
  setFrontmatterValue,
  renameFrontmatterKey,
  deleteFrontmatterKey,
  addFrontmatterKey,
  frontmatterTableHtml,
} from "./frontmatter";

const YAML = [
  "type: project",
  'name: "AIナレッジ化"',
  "count: 3",
  "active: true",
  "empty:",
  "tags:",
  "  - a",
  "  - b",
  "flow: [x, y]",
  "meta:",
  "  owner: me",
].join("\n");

describe("splitFrontmatter（先頭の --- ブロックの切り出し）", () => {
  it("先頭の --- ... --- を YAML と本文に分ける", () => {
    const r = splitFrontmatter(`---\n${YAML}\n---\n\n# 見出し\n本文\n`);
    expect(r?.yaml).toBe(YAML);
    expect(r?.body).toBe("\n# 見出し\n本文\n");
  });
  it("CRLF でも切り出せる", () => {
    const r = splitFrontmatter("---\r\na: 1\r\n---\r\nbody\r\n");
    expect(r?.yaml).toBe("a: 1");
    expect(r?.body).toBe("body\r\n");
  });
  it("空の frontmatter（--- 直後に ---）も対象", () => {
    expect(splitFrontmatter("---\n---\nbody")).toEqual({ yaml: "", body: "body" });
  });
  it("先頭でない --- や閉じが無いものは対象外", () => {
    expect(splitFrontmatter("\n---\na: 1\n---\n")).toBeNull();
    expect(splitFrontmatter("# 見出し\n---\na: 1\n---\n")).toBeNull();
    expect(splitFrontmatter("---\na: 1\n")).toBeNull();
    expect(splitFrontmatter("--- a\nb\n---\n")).toBeNull();
  });
});

describe("parseFrontmatterRows（YAML → 表の行）", () => {
  it("トップレベルのキーごとに行を作り、種類と表示文字列を返す", () => {
    const { rows, error } = parseFrontmatterRows(YAML);
    expect(error).toBeNull();
    expect(rows.map((r) => [r.key, r.kind, r.value])).toEqual([
      ["type", "scalar", "project"],
      ["name", "scalar", "AIナレッジ化"],
      ["count", "scalar", "3"],
      ["active", "scalar", "true"],
      ["empty", "scalar", ""],
      ["tags", "list", "a, b"],
      ["flow", "list", "x, y"],
      ["meta", "complex", "{ owner: me }"],
    ]);
  });
  it("壊れた YAML は error を返し行は空", () => {
    const { rows, error } = parseFrontmatterRows("a: [1, 2\nb: : c");
    expect(rows).toEqual([]);
    expect(error).toBeTruthy();
  });
  it("トップレベルがマップでない場合も error", () => {
    expect(parseFrontmatterRows("- a\n- b").error).toBeTruthy();
    expect(parseFrontmatterRows("").rows).toEqual([]);
    expect(parseFrontmatterRows("").error).toBeNull();
  });
});

describe("値の書き換え（元の書き方をできるだけ保つ）", () => {
  it("引用符付き文字列は引用符を保ったまま値を差し替える", () => {
    const out = setFrontmatterValue(YAML, "name", "新しい名前");
    expect(out.split("\n")[1]).toBe('name: "新しい名前"');
    // 他の行は変えない
    expect(out.split("\n")[0]).toBe("type: project");
  });
  it("数値・真偽値は型を保って保存し、型が変わったら表記を作り直す", () => {
    expect(setFrontmatterValue("n: 3", "n", "4")).toBe("n: 4");
    expect(setFrontmatterValue("f: true", "f", "false")).toBe("f: false");
    expect(setFrontmatterValue("n: 3", "n", "abc")).toBe("n: abc");
    // 引用符付きの文字列は、文字列のままなら引用符を保つ
    expect(setFrontmatterValue('s: "3"', "s", "abc")).toBe('s: "abc"');
    // 引用符付きの文字列が数値になれば引用符を外す
    expect(setFrontmatterValue('s: "3"', "s", "4")).toBe("s: 4");
  });
  it("空文字は値なし（key:）として保存する", () => {
    expect(setFrontmatterValue("a: x\nb: y", "a", "")).toBe("a:\nb: y");
  });
  it("リストはカンマ区切りを項目に分け、ブロック/フロー形式を保つ", () => {
    expect(setFrontmatterValue("tags:\n  - a\n  - b", "tags", "c, d, e")).toBe(
      "tags:\n  - c\n  - d\n  - e",
    );
    expect(setFrontmatterValue("flow: [x, y]", "flow", "p,q")).toMatch(
      /^flow: \[ ?p, q ?\]$/,
    );
  });
  it("リストの項目も数値などの型を解釈する", () => {
    expect(setFrontmatterValue("n:\n  - 1", "n", "2, x")).toBe("n:\n  - 2\n  - x");
  });
  it("複雑な値は YAML として解釈して差し替える", () => {
    expect(setFrontmatterValue("meta:\n  owner: me", "meta", "{ owner: you, n: 1 }")).toBe(
      "meta:\n  owner: you\n  n: 1",
    );
  });
  it("YAML として読めない値はプレーン文字列として保存する", () => {
    const out = setFrontmatterValue("a: 1", "a", "[broken");
    expect(parseFrontmatterRows(out).rows[0].value).toBe("[broken");
  });
});

describe("キーの追加・改名・削除", () => {
  it("renameFrontmatterKey は値と位置を保ったままキー名だけ変える", () => {
    expect(renameFrontmatterKey("a: 1\nb: 2", "a", "z")).toBe("z: 1\nb: 2");
  });
  it("既存キーと重複する改名や空のキー名は変更しない", () => {
    expect(renameFrontmatterKey("a: 1\nb: 2", "a", "b")).toBe("a: 1\nb: 2");
    expect(renameFrontmatterKey("a: 1", "a", "  ")).toBe("a: 1");
  });
  it("deleteFrontmatterKey は該当行を取り除く", () => {
    expect(deleteFrontmatterKey("a: 1\nb: 2\nc: 3", "b")).toBe("a: 1\nc: 3");
  });
  it("addFrontmatterKey は末尾に値なしのキーを足し、重複は足さない", () => {
    expect(addFrontmatterKey("a: 1", "b")).toBe("a: 1\nb:");
    expect(addFrontmatterKey("a: 1", "a")).toBe("a: 1");
    expect(addFrontmatterKey("", "a")).toBe("a:");
  });
});

describe("frontmatterTableHtml（出力用の 2 列表）", () => {
  it("キーと値をエスケープして表にする", () => {
    const html = frontmatterTableHtml('title: "<b>x</b>"\ntags: [a, b]');
    expect(html).toContain('<table class="frontmatter">');
    expect(html).toContain("<th>title</th><td>&lt;b&gt;x&lt;/b&gt;</td>");
    expect(html).toContain("<th>tags</th><td>a, b</td>");
  });
  it("壊れた YAML は <pre> でそのまま出す", () => {
    const html = frontmatterTableHtml("a: [1");
    expect(html).toContain("<pre");
    expect(html).toContain("a: [1");
  });
  it("空なら空文字", () => {
    expect(frontmatterTableHtml("")).toBe("");
  });
});
