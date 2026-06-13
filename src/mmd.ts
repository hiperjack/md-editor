/**
 * .mmd（Mermaid単体ファイル）対応のヘルパー。
 *
 * エディタはMilkdown（WYSIWYG markdown）単一実装のため、.mmd は
 * 「ファイル全体を1つの ```mermaid フェンスにラップした markdown」として
 * エディタに載せる。コードブロック内の編集は実質プレーンテキスト編集であり、
 * Crepe の renderPreview によってブロック直下に図のプレビューが出る。
 * 保存時はフェンスを外して元のプレーンな Mermaid ソースに戻す。
 */

export type FileType = "md" | "mmd";

export function fileTypeOfPath(path: string | null | undefined): FileType {
  return path && /\.(mmd|mermaid)$/i.test(path) ? "mmd" : "md";
}

/** Mermaidソースを単一の ```mermaid フェンスでラップする。 */
export function wrapMermaidSource(source: string): string {
  // ソース行頭にバッククォート連続があってもフェンスが壊れないよう、
  // 最長の連続+1（最低3）の長さでフェンスを張る。
  let maxRun = 0;
  for (const m of source.matchAll(/^`+/gm)) {
    maxRun = Math.max(maxRun, m[0].length);
  }
  const fence = "`".repeat(Math.max(3, maxRun + 1));
  const body = source === "" || source.endsWith("\n") ? source : `${source}\n`;
  return `${fence}mermaid\n${body}${fence}\n`;
}

/**
 * エディタのmarkdownから Mermaid ソースを取り出す。
 * - 文書が「単一の mermaid フェンスのみ」なら、その中身を返す（通常ケース）。
 * - フェンス外に実内容がある場合は、データを失わないよう全文をそのまま返す
 *   （.mmd としては不正だがユーザーの入力を保全する）。
 */
export function extractMermaidSource(markdown: string): string {
  // 言語ピッカー等で "Mermaid" と大文字になっても拾えるよう大文字小文字は無視
  const re = /^(`{3,})mermaid[ \t]*\n([\s\S]*?)\n?\1[ \t]*$/im;
  const m = re.exec(markdown);
  if (!m) return markdown;
  const outside = (
    markdown.slice(0, m.index) + markdown.slice(m.index + m[0].length)
  ).trim();
  if (outside !== "") return markdown;
  const body = m[2];
  if (body === "") return "";
  return body.endsWith("\n") ? body : `${body}\n`;
}
