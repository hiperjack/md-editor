/**
 * frontmatter（ファイル先頭の `---` で囲まれた YAML）の純粋ロジック。
 *
 * Obsidian の「プロパティ」に相当する。エディタ側（frontmatter-node.ts の
 * NodeView）と出力側（render-pipeline.ts）の両方がここを使う。
 *
 *  - splitFrontmatter: markdown 文字列から先頭の frontmatter を切り出す
 *    （出力パイプライン用。エディタ側は remark-frontmatter が同じ規則で解釈する）。
 *  - parseFrontmatterRows: YAML をトップレベルのキーごとの「表の行」に変換する。
 *  - set/rename/delete/addFrontmatterKey: 行の編集を YAML に書き戻す。
 *    yaml の Document を使い、触っていない行の書き方（引用符・ブロック/フロー形式・
 *    コメント）はできるだけそのまま保つ。
 *  - frontmatterTableHtml: HTML/PDF/スライド出力用の 2 列表。
 */
import {
  parseDocument,
  parse as parseYaml,
  isMap,
  isSeq,
  isScalar,
  isPair,
  Document,
  Scalar,
  YAMLSeq,
  type Pair,
} from "yaml";

export type FrontmatterRowKind = "scalar" | "list" | "complex";

export type FrontmatterRow = {
  key: string;
  /** 表に見せる文字列。scalar はそのまま、list は「a, b」、complex はフロー形式の YAML。 */
  value: string;
  kind: FrontmatterRowKind;
};

export type FrontmatterRows = {
  rows: FrontmatterRow[];
  /** YAML として読めない、またはトップレベルがマップでないときのメッセージ。 */
  error: string | null;
};

const DELIM_RE = /^---[ \t]*$/;

/**
 * 先頭の `---` ... `---` ブロックを切り出す。remark-frontmatter と同じく、
 * 1 行目がちょうど `---` で、以降に `---` だけの行があるときだけ対象にする。
 * 改行コードは LF/CRLF の両方に対応し、body は元の改行コードのまま返す。
 */
export function splitFrontmatter(
  src: string,
): { yaml: string; body: string } | null {
  const nl = src.includes("\r\n") ? "\r\n" : "\n";
  const lines = src.split(nl);
  if (lines.length < 2 || !DELIM_RE.test(lines[0])) return null;
  for (let i = 1; i < lines.length; i++) {
    if (DELIM_RE.test(lines[i])) {
      return {
        yaml: lines.slice(1, i).join("\n"),
        body: lines.slice(i + 1).join(nl),
      };
    }
  }
  return null;
}

/** 値を 1 行の表示文字列にする。 */
function displayOf(node: unknown): { value: string; kind: FrontmatterRowKind } {
  if (isSeq(node) && node.items.every((it) => isScalar(it))) {
    return {
      kind: "list",
      value: node.items.map((it) => scalarText((it as Scalar).value)).join(", "),
    };
  }
  if (isScalar(node)) return { kind: "scalar", value: scalarText(node.value) };
  // マップ・入れ子リストなどはフロー形式の YAML 1 行で見せる。
  const doc = new Document(node);
  if (isMap(doc.contents) || isSeq(doc.contents)) doc.contents.flow = true;
  return { kind: "complex", value: doc.toString().trim() };
}

function scalarText(v: unknown): string {
  if (v === null || v === undefined) return "";
  return String(v);
}

export function parseFrontmatterRows(yamlText: string): FrontmatterRows {
  if (yamlText.trim() === "") return { rows: [], error: null };
  const doc = parseDocument(yamlText);
  if (doc.errors.length > 0) {
    return { rows: [], error: doc.errors.map((e) => e.message).join("\n") };
  }
  if (!isMap(doc.contents)) {
    return { rows: [], error: "frontmatter is not a mapping" };
  }
  const rows: FrontmatterRow[] = [];
  for (const pair of doc.contents.items) {
    const key = isScalar(pair.key) ? scalarText(pair.key.value) : String(pair.key);
    rows.push({ key, ...displayOf(pair.value) });
  }
  return { rows, error: null };
}

/** 編集後の Document を文字列へ戻す（末尾改行なし、空値は `key:`）。 */
function docToText(doc: Document): string {
  return doc.toString({ nullStr: "" }).replace(/\n$/, "");
}

/** 入力文字列を YAML スカラとして解釈する。読めなければプレーン文字列のまま。 */
function parseScalarInput(text: string): unknown {
  if (text.trim() === "") return null;
  try {
    const v = parseYaml(text);
    return v;
  } catch {
    return text;
  }
}

function sameScalarType(a: unknown, b: unknown): boolean {
  if (a === null || b === null) return a === b;
  return typeof a === typeof b;
}

function loadMap(yamlText: string): Document | null {
  const doc = yamlText.trim() === "" ? new Document({}) : parseDocument(yamlText);
  if (doc.errors.length > 0) return null;
  if (doc.contents === null) doc.contents = doc.createNode({});
  if (!isMap(doc.contents)) return null;
  return doc;
}

function findPair(doc: Document, key: string): Pair | undefined {
  if (!isMap(doc.contents)) return undefined;
  return doc.contents.items.find(
    (p) => isPair(p) && isScalar(p.key) && scalarText(p.key.value) === key,
  );
}

/**
 * key の値を表示文字列から書き戻す。
 *  - scalar: 型（数値・真偽値）を解釈し、引用符付き文字列は引用符を保つ。
 *  - list: カンマ区切りを項目に分け、元のブロック/フロー形式を保つ。
 *  - complex（その他）: 文字列全体を YAML として解釈して差し替える。
 */
export function setFrontmatterValue(
  yamlText: string,
  key: string,
  text: string,
): string {
  const doc = loadMap(yamlText);
  if (!doc) return yamlText;
  const pair = findPair(doc, key);
  if (!pair) return yamlText;
  const cur = pair.value;

  if (isSeq(cur) && cur.items.every((it) => isScalar(it))) {
    const items = text
      .split(",")
      .map((s) => s.trim())
      .filter((s) => s !== "")
      .map((s) => parseScalarInput(s));
    const seq = new YAMLSeq();
    seq.flow = cur.flow;
    for (const it of items) seq.add(doc.createNode(it));
    pair.value = seq;
    return docToText(doc);
  }

  if (isScalar(cur) || cur === null || cur === undefined) {
    const next = parseScalarInput(text);
    const isPlainScalar =
      next === null || ["string", "number", "boolean"].includes(typeof next);
    if (isPlainScalar) {
      if (isScalar(cur)) {
        // 引用符などの表記は、型が変わらない限り保つ。
        if (!sameScalarType(cur.value, next)) cur.type = undefined;
        cur.value = next;
      } else {
        pair.value = doc.createNode(next);
      }
    } else {
      pair.value = doc.createNode(next);
    }
    return docToText(doc);
  }

  // マップ・入れ子リストなど。
  const next = parseScalarInput(text);
  pair.value = doc.createNode(next);
  return docToText(doc);
}

export function renameFrontmatterKey(
  yamlText: string,
  oldKey: string,
  newKey: string,
): string {
  const name = newKey.trim();
  if (name === "" || name === oldKey) return yamlText;
  const doc = loadMap(yamlText);
  if (!doc) return yamlText;
  if (findPair(doc, name)) return yamlText;
  const pair = findPair(doc, oldKey);
  if (!pair) return yamlText;
  if (isScalar(pair.key)) pair.key.value = name;
  else pair.key = doc.createNode(name);
  return docToText(doc);
}

export function deleteFrontmatterKey(yamlText: string, key: string): string {
  const doc = loadMap(yamlText);
  if (!doc || !findPair(doc, key)) return yamlText;
  doc.delete(key);
  return docToText(doc);
}

export function addFrontmatterKey(yamlText: string, key: string): string {
  const name = key.trim();
  if (name === "") return yamlText;
  // 空の YAML に対して yaml の Document 経由で足すと `? key` 形式になるため直接書く。
  if (yamlText.trim() === "") return `${name}:`;
  const doc = loadMap(yamlText);
  if (!doc || findPair(doc, name)) return yamlText;
  doc.set(name, null);
  return docToText(doc);
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** 出力用: キーと値の 2 列表。YAML が壊れていれば <pre> で原文を出す。 */
export function frontmatterTableHtml(yamlText: string): string {
  if (yamlText.trim() === "") return "";
  const { rows, error } = parseFrontmatterRows(yamlText);
  if (error) {
    return `<pre class="frontmatter frontmatter-raw">${escapeHtml(yamlText)}</pre>\n`;
  }
  const body = rows
    .map(
      (r) =>
        `<tr><th>${escapeHtml(r.key)}</th><td>${escapeHtml(r.value)}</td></tr>`,
    )
    .join("");
  return `<table class="frontmatter"><tbody>${body}</tbody></table>\n`;
}
