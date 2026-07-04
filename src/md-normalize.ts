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
