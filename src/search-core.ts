/**
 * 検索の純粋ロジック（DOM/ProseMirror 非依存、単体テスト可能）。
 * RegExp の構築と、1ブロック分の文字列に対するマッチ抽出を担う。
 */

export type SearchOptions = {
  caseSensitive: boolean;
  regex: boolean;
  wholeWord: boolean;
};

export type TextMatch = {
  /** マッチ開始位置（文字列インデックス）。 */
  start: number;
  /** マッチ終了位置（exclusive）。 */
  end: number;
  /** マッチ全体の文字列。regex 置換のキャプチャ参照解決に使う。 */
  match: string;
  /** キャプチャグループ（regex 時のみ意味を持つ）。 */
  groups: string[];
};

/** 正規表現の特殊文字をエスケープしてリテラル検索にする。 */
function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * オプションに応じて検索用 RegExp を構築する。
 * - 空クエリや不正な regex は null を返す（呼び出し側で「0件」として扱う）。
 * - 常に global フラグ付き。caseSensitive=false なら ignoreCase。
 */
export function buildSearchRegex(
  query: string,
  opts: SearchOptions,
): RegExp | null {
  if (query === "") return null;

  let source = opts.regex ? query : escapeRegExp(query);
  if (opts.wholeWord) source = `\\b(?:${source})\\b`;

  const flags = opts.caseSensitive ? "g" : "gi";
  try {
    return new RegExp(source, flags);
  } catch {
    // 不正な正規表現
    return null;
  }
}

/**
 * 1ブロック分の文字列に対して全マッチを返す。
 * 長さ0のマッチ（例: `a*` が空文字に一致）は無限ループを避けるためスキップしつつ
 * 検索位置を1つ進める。
 */
export function findRangesInText(text: string, re: RegExp): TextMatch[] {
  const result: TextMatch[] = [];
  re.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    const start = m.index;
    const end = start + m[0].length;
    if (m[0].length === 0) {
      // 空マッチは記録せず、次の文字へ進める
      re.lastIndex = start + 1;
      continue;
    }
    result.push({
      start,
      end,
      match: m[0],
      groups: m.slice(1).map((g) => g ?? ""),
    });
  }
  return result;
}

/**
 * 置換文字列を解決する。
 * regex モードでは以下を展開する:
 * - エスケープ `\n`(改行) / `\t`(タブ) / `\r`(CR) / `\\`(リテラル `\`)、
 *   未知のエスケープ `\x` はバックスラッシュを落として `x` を残す。
 * - キャプチャ参照 `$1`〜`$99` / `$&`(マッチ全体) / `$$`(リテラル `$`)。
 * 非 regex モードでは replacement をそのまま返す。
 *
 * 置換文字列を先頭から1文字ずつ走査する単一パス。キャプチャで差し込んだ文字列は
 * 再走査しないため、キャプチャ内のバックスラッシュを二重解釈しない。
 */
export function resolveReplacement(
  match: { match: string; groups: string[] },
  replacement: string,
  isRegex: boolean,
): string {
  if (!isRegex) return replacement;
  let out = "";
  for (let i = 0; i < replacement.length; i++) {
    const c = replacement[i];
    // バックスラッシュエスケープ
    if (c === "\\" && i + 1 < replacement.length) {
      const n = replacement[i + 1];
      i++;
      if (n === "n") out += "\n";
      else if (n === "t") out += "\t";
      else if (n === "r") out += "\r";
      else if (n === "\\") out += "\\";
      else out += n; // 未知のエスケープはバックスラッシュを落とす
      continue;
    }
    // キャプチャ参照
    if (c === "$" && i + 1 < replacement.length) {
      const n = replacement[i + 1];
      if (n === "$") {
        out += "$";
        i++;
        continue;
      }
      if (n === "&") {
        out += match.match;
        i++;
        continue;
      }
      if (n >= "0" && n <= "9") {
        // 1〜2桁の番号。差し込んだキャプチャ文字列は再走査しない（二重解釈防止）。
        let digits = n;
        const n2 = replacement[i + 2];
        if (n2 !== undefined && n2 >= "0" && n2 <= "9") digits += n2;
        out += match.groups[parseInt(digits, 10) - 1] ?? "";
        i += digits.length;
        continue;
      }
    }
    out += c;
  }
  return out;
}
