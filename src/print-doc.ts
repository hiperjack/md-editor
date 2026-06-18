/**
 * 印刷用HTML文書の組み立て（純粋関数・DOM/Tauri非依存）。
 *
 * 印刷はメインウィンドウを print メディアにせず、非表示 iframe に
 * 自己完結HTML（exporter.buildStandaloneHtml の出力）を流し込んで行う
 * （print.ts）。これにより印刷プレビュー表示中もエディタ本体は
 * 元のテーマ色・UIのまま表示される。本モジュールはその iframe に
 * 注入する印刷CSS（@page と紙面スタイル）の組み立てを担う。
 */

export type PrintOrientation = "portrait" | "landscape";

/** 用紙サイズ・向きの @page ルール。 */
export function printPageRule(orientation: PrintOrientation): string {
  return `@page { size: A4 ${orientation}; margin: 20mm 18mm; }`;
}

/**
 * 紙面向けの印刷スタイル（iframe 内文書にのみ適用される）。
 * - 紙は白、文書背景は塗らない（ダーク設定でもインクを使わない）
 * - 見出し直後の改ページ抑止、コード/表/図/コールアウトの分断回避
 * - 背景色が意味を持つ要素のみ色を保持（print-color-adjust: exact）
 */
export const PRINT_MEDIA_CSS = `@media print {
  html, body { background: #fff !important; }
  .document { background: transparent !important; max-width: none; padding: 0; }
  .document h1, .document h2, .document h3 { break-after: avoid; }
  .document pre, .document table, .document figure, .document .markdown-alert { break-inside: avoid; }
  /* orphans/widows は指定しない。3行未満の短い段落（例: "aa" だけの文書）で
     Chromium/WebView2 の印刷プレビュー組版がループしてプレビューが生成されない
     既知の不具合を避けるため。重要ブロックの分断回避は break-inside で担保する。 */
  .document pre, .document code, .document .markdown-alert, .document thead th, .document nav.table-of-contents {
    -webkit-print-color-adjust: exact;
    print-color-adjust: exact;
  }
}`;

/**
 * 自己完結HTML（buildStandaloneHtml の出力）に、@page と印刷CSSを
 * <head> 末尾へ注入した「印刷用HTML文書」を返す。
 * </head> が無い場合は先頭に付与する（フォールバック）。
 */
export function buildPrintDocument(
  standaloneHtml: string,
  orientation: PrintOrientation,
): string {
  const style = `<style>\n${printPageRule(orientation)}\n${PRINT_MEDIA_CSS}\n</style>`;
  if (standaloneHtml.includes("</head>")) {
    return standaloneHtml.replace("</head>", `${style}\n</head>`);
  }
  return style + standaloneHtml;
}
