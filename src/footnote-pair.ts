/**
 * 脚注ペアのリアルタイム着色（ProseMirror デコレーション）。
 *
 * WYSIWYG 上で手入力した [^1] / 行頭 [^1]: は remark 再パースまでただの
 * テキストで、既定では青色（脚注ノードのCSS）にならない。本モジュールは
 * doc 変更のたびに参照/定義ラベルを収集してペア判定し、
 *  - ペア成立したテキスト状態のトークンへ .fn-pair を付けて青くする
 *  - ペアが崩れたノード化済み脚注へ .fn-unpaired を付けて色を戻す
 * 文書そのものは書き換えない（undo・カーソル・Markdown原文に影響なし）。
 */

export type FnTokenKind = "ref" | "def";

export interface FnToken {
  kind: FnTokenKind;
  label: string;
  /** テキスト内オフセット。def の to は末尾の ':' を含む。 */
  from: number;
  to: number;
}

const TOKEN_RE = /\[\^([^\]\s]+)\]/g;

/** 直前の連続バックスラッシュが奇数個ならエスケープされている。 */
function isEscaped(text: string, index: number): boolean {
  let n = 0;
  for (let i = index - 1; i >= 0 && text[i] === "\\"; i--) n++;
  return n % 2 === 1;
}

/**
 * 段落1つ分のテキストから脚注トークンを走査する。
 * text は「テキストそのまま・hardbreak は \n・その他インライン要素と
 * インラインコードは半角スペース埋め」の文字列（オフセット＝doc相対位置）。
 * 行頭（先頭または \n 直後）かつ直後に ':' が続くものは定義、他は参照。
 */
export function scanFootnoteTokens(text: string): FnToken[] {
  const out: FnToken[] = [];
  TOKEN_RE.lastIndex = 0;
  for (let m = TOKEN_RE.exec(text); m; m = TOKEN_RE.exec(text)) {
    if (isEscaped(text, m.index)) continue;
    const label = m[1];
    const atLineStart = m.index === 0 || text[m.index - 1] === "\n";
    const end = m.index + m[0].length;
    if (atLineStart && text[end] === ":") {
      out.push({ kind: "def", label, from: m.index, to: end + 1 });
    } else {
      out.push({ kind: "ref", label, from: m.index, to: end });
    }
  }
  return out;
}
