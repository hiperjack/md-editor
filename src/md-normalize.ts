/**
 * プレビュー/出力レンダリング前の markdown 正規化。
 *
 * markdown-it（および CommonMark）は、表の直前に空行が無いと表を表として
 * 認識せず、直前のリスト項目や段落の「継続行」に飲み込んで崩す。本エディタは
 * 「単一改行＝区切り」方針（remark-breaks）のため、ユーザーはリストの次行に
 * 空行なしで表を書くことがある。プレビュー/出力でもそれを表として描けるよう、
 * 表ブロックの直前に空行を補う。エディタ本体や保存ファイルには手を加えない。
 */

/** 表の区切り行（例: `| :--- | ---: |`）か。パイプを含むものだけ対象にする。 */
function isDelimiterRow(s: string): boolean {
  return (
    s.includes("|") && /^\s*\|?\s*:?-+:?\s*(\|\s*:?-+:?\s*)*\|?\s*$/.test(s)
  );
}

/** 表の行らしい（パイプを含む非空行）か。 */
function isTableRowish(s: string): boolean {
  return s.includes("|") && s.trim() !== "";
}

/** 脚注定義行（例: `[^1]: 本文`）か。 */
function isFootnoteDef(s: string): boolean {
  return /^\[\^[^\]\s]+\]:/.test(s);
}

/**
 * 脚注定義（`[^1]: …`）の直前が「非空かつ脚注定義でない行」なら、空行を1行挿入する。
 * markdown-it は直前に空行が無い定義を段落の継続行として飲み込み、脚注として
 * 認識しない。本エディタは「単一改行＝区切り」方針のため、段落の次行に空行なしで
 * 定義を書くことがある（表の正規化と同じ理由・同じ方針）。フェンス内は対象外。
 */
export function ensureBlankLineBeforeFootnoteDefs(src: string): string {
  const lines = src.split("\n");
  const out: string[] = [];
  let inFence = false;
  let fenceChar = "";

  for (const line of lines) {
    const fence = /^\s*(`{3,}|~{3,})/.exec(line);
    if (fence) {
      const ch = fence[1][0];
      if (!inFence) {
        inFence = true;
        fenceChar = ch;
      } else if (ch === fenceChar) {
        inFence = false;
      }
      out.push(line);
      continue;
    }

    if (!inFence && isFootnoteDef(line) && out.length > 0) {
      const prev = out[out.length - 1];
      // 直前が非空 かつ 脚注定義でない（= 本文段落）の場合に空行を補う。
      // 連続する定義同士（[^1]: の次の行に [^2]:）はそのまま繋げてよい。
      if (prev.trim() !== "" && !isFootnoteDef(prev)) {
        out.push("");
      }
    }

    out.push(line);
  }

  return out.join("\n");
}

/**
 * 表（ヘッダ行＋区切り行）の直前が「非空かつ表行でない行」なら、空行を1行挿入する。
 * フェンスドコードブロック（``` / ~~~）の内側は対象外。
 */
export function ensureBlankLineBeforeTables(src: string): string {
  const lines = src.split("\n");
  const out: string[] = [];
  let inFence = false;
  let fenceChar = "";

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const fence = /^\s*(`{3,}|~{3,})/.exec(line);
    if (fence) {
      const ch = fence[1][0];
      if (!inFence) {
        inFence = true;
        fenceChar = ch;
      } else if (ch === fenceChar) {
        inFence = false;
      }
      out.push(line);
      continue;
    }

    if (
      !inFence &&
      isTableRowish(line) &&
      i + 1 < lines.length &&
      isDelimiterRow(lines[i + 1]) &&
      out.length > 0
    ) {
      const prev = out[out.length - 1];
      // 直前が非空 かつ 表行でない（= リスト項目や段落）の場合に空行を補う。
      if (prev.trim() !== "" && !isTableRowish(prev)) {
        out.push("");
      }
    }

    out.push(line);
  }

  return out.join("\n");
}

/**
 * リンク・画像のリンク先に半角スペースを含む `[a](my file.md)` を `[a](<my file.md>)` に直す。
 *
 * CommonMark ではリンク先にスペースを直接書けず（`<>` 囲みか `%20` が必要）、
 * そのままだとリンクとして認識されない。エディタ（remark）はそれを通常の文字として
 * 取り込み、書き戻し時に `]\(` とエスケープしてファイルを書き換えてしまうため、
 * 解釈の直前（ファイル読込・ソース表示からの復帰・貼り付け・HTML出力）で補正する。
 *
 * - `[a](url "タイトル")` のタイトル（`"…"` / `'…'` / `(…)`）は残し、リンク先だけを囲む
 * - 既に `<>` 形式のもの、スペースを含まないものは変更しない
 * - フェンスドコードブロックとインラインコードの中は対象外
 */
export function wrapSpacedLinkDestinations(src: string): string {
  if (!src.includes("](")) return src;
  const lines = src.split("\n");
  let inFence = false;
  let fenceChar = "";
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const fence = /^\s*(`{3,}|~{3,})/.exec(line);
    if (fence) {
      const ch = fence[1][0];
      if (!inFence) {
        inFence = true;
        fenceChar = ch;
      } else if (ch === fenceChar) {
        inFence = false;
      }
      continue;
    }
    if (inFence || !line.includes("](")) continue;
    // インラインコード（`…` / ``…``）を避け、それ以外の区間だけを処理する。
    lines[i] = line
      .split(/(`+[^`]*?`+)/)
      .map((seg, k) => (k % 2 === 1 ? seg : wrapInSegment(seg)))
      .join("");
  }
  return lines.join("\n");
}

/** バックスラッシュでエスケープされた文字か。 */
function isEscaped(s: string, pos: number): boolean {
  let n = 0;
  for (let j = pos - 1; j >= 0 && s[j] === "\\"; j--) n++;
  return n % 2 === 1;
}

/** `]` の位置から対応する `[` を後方に探す。見つからなければ -1。 */
function findOpenBracket(s: string, close: number): number {
  let depth = 0;
  for (let j = close - 1; j >= 0; j--) {
    if (isEscaped(s, j)) continue;
    if (s[j] === "]") depth++;
    else if (s[j] === "[") {
      if (depth === 0) return j;
      depth--;
    }
  }
  return -1;
}

/** `(` の直後から対応する `)` を探す（入れ子の括弧を数える）。見つからなければ -1。 */
function findCloseParen(s: string, from: number): number {
  let depth = 0;
  for (let j = from; j < s.length; j++) {
    if (isEscaped(s, j)) continue;
    if (s[j] === "(") depth++;
    else if (s[j] === ")") {
      if (depth === 0) return j;
      depth--;
    }
  }
  return -1;
}

const LINK_TITLE_RE =
  /^(.*?)\s+("(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|\((?:[^()\\]|\\.)*\))$/;

function wrapInSegment(seg: string): string {
  let out = "";
  let pos = 0;
  let idx = seg.indexOf("](");
  while (idx >= 0) {
    const innerStart = idx + 2;
    const close =
      !isEscaped(seg, idx) && findOpenBracket(seg, idx) >= 0
        ? findCloseParen(seg, innerStart)
        : -1;
    if (close < 0) {
      idx = seg.indexOf("](", innerStart);
      continue;
    }
    const inner = seg.slice(innerStart, close);
    out += seg.slice(pos, innerStart) + wrapDestination(inner) + ")";
    pos = close + 1;
    idx = seg.indexOf("](", pos);
  }
  return out + seg.slice(pos);
}

/**
 * markdown に書き出すリンク先（画像の src 等）を整形する。空白・制御文字を含むときは
 * `<>` で囲む（中の `<` `>` はエスケープ）。remark 標準のリンク出力と同じ規則で、
 * 独自の画像ハンドラ（editor.ts）が URL をそのまま書いて壊さないようにするためのもの。
 */
export function formatMarkdownDestination(url: string): string {
  if (!/[\u0000- \u007f]/.test(url)) return url;
  return "<" + url.replace(/([<>])/g, "\\$1") + ">";
}

/** `(...)` の中身を受け取り、リンク先にスペースがあれば `<>` で囲んだ中身を返す。 */
function wrapDestination(inner: string): string {
  const trimmed = inner.trim();
  if (trimmed === "" || trimmed.startsWith("<")) return inner;
  const m = LINK_TITLE_RE.exec(trimmed);
  const dest = m ? m[1].trim() : trimmed;
  const title = m ? m[2] : "";
  if (!/\s/.test(dest) || /[<>]/.test(dest)) return inner;
  return `<${dest}>` + (title ? ` ${title}` : "");
}
