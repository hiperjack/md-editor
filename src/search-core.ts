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
 * regex モードでは `$1`〜`$9` / `$&`（マッチ全体）/ `$$`（リテラル $）を展開する。
 * 非 regex モードでは replacement をそのまま返す。
 */
export function resolveReplacement(
  match: { match: string; groups: string[] },
  replacement: string,
  isRegex: boolean,
): string {
  if (!isRegex) return replacement;
  return replacement.replace(/\$(\$|&|\d{1,2})/g, (_, token: string) => {
    if (token === "$") return "$";
    if (token === "&") return match.match;
    const idx = parseInt(token, 10) - 1;
    return match.groups[idx] ?? "";
  });
}
