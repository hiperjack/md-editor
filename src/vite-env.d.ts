/// <reference types="vite/client" />

// markdown-it-footnote は型定義を同梱しないため最小限の宣言を用意する。
declare module "markdown-it-footnote" {
  import type MarkdownIt from "markdown-it";
  const plugin: (md: MarkdownIt) => void;
  export default plugin;
}
