import { invoke } from "@tauri-apps/api/core";
import { emit, listen } from "@tauri-apps/api/event";

/**
 * 文書テーマ（HTML出力・PDF印刷・設定モーダル内サンプルの3経路で共有）。
 *
 * アプリUIの設定（settings.ts / localStorage）とは独立に、
 * {appDataDir}/settings.json へRustコマンド経由で永続化する。
 * 出力物の見た目を決める「ユーザー資産」なので、WebViewのデータ消去に
 * 巻き込まれないファイル保存とし、versionキーで将来の項目追加に備える。
 */

export type DocFontId = "yu-gothic" | "meiryo" | "biz-ud" | "noto-sans";
export type HeadingStyle = "none" | "underline" | "left-border";
export type HighlightTheme = "github" | "atom-one-dark" | "vs";
/** Mermaid図の配色。"system" はOSのライト/ダーク設定に追従する。 */
export type MermaidColorScheme = "system" | "light" | "dark";

export type DocTheme = {
  fontFamily: DocFontId;
  /** 本文フォントサイズ px（12〜20） */
  fontSize: number;
  /** 行間（1.4〜2.0） */
  lineHeight: number;
  /** 見出し・リンク・罫線のアクセント色 */
  accentColor: string;
  textColor: string;
  bgColor: string;
  headingStyle: HeadingStyle;
  highlightTheme: HighlightTheme;
  /** Mermaid図の配色（mermaidFollowApp=false のときに使用） */
  mermaidTheme: MermaidColorScheme;
  /** Mermaid配色をアプリの表示テーマに揃えるか（true=揃える、false=mermaidThemeで個別指定） */
  mermaidFollowApp: boolean;
};

export type DocDecorations = {
  /** 出力時に目次を自動挿入（明示の [[toc]] は設定によらず常に有効） */
  autoToc: boolean;
  /** h1〜h3にCSSカウンタで番号を付与 */
  headingNumbers: boolean;
  /** > [!NOTE] 等のコールアウト変換 */
  callouts: boolean;
  /** 表の縞模様 */
  stripedTables: boolean;
};

export type DocSettings = {
  version: 1;
  theme: DocTheme;
  decorations: DocDecorations;
};

export const DOC_FONT_PRESETS: { id: DocFontId; labelKey: string; css: string }[] = [
  {
    id: "yu-gothic",
    labelKey: "docTheme.font.yuGothic",
    css: "'Yu Gothic Medium', 'Yu Gothic', YuGothic, 'Yu Gothic UI', sans-serif",
  },
  {
    id: "meiryo",
    labelKey: "docTheme.font.meiryo",
    css: "Meiryo, 'Meiryo UI', sans-serif",
  },
  {
    id: "biz-ud",
    labelKey: "docTheme.font.bizUd",
    css: "'BIZ UDPGothic', 'BIZ UDGothic', Meiryo, sans-serif",
  },
  {
    id: "noto-sans",
    labelKey: "docTheme.font.notoSans",
    css: "'Noto Sans JP', 'Noto Sans CJK JP', 'Yu Gothic', sans-serif",
  },
];

export const DEFAULT_DOC_SETTINGS: DocSettings = {
  version: 1,
  theme: {
    fontFamily: "yu-gothic",
    fontSize: 16,
    lineHeight: 1.7,
    accentColor: "#2563eb",
    textColor: "#1f2937",
    bgColor: "#ffffff",
    headingStyle: "underline",
    highlightTheme: "github",
    mermaidTheme: "system",
    mermaidFollowApp: true,
  },
  decorations: {
    autoToc: false,
    headingNumbers: false,
    callouts: true,
    stripedTables: true,
  },
};

const FONT_SIZE_MIN = 12;
const FONT_SIZE_MAX = 20;
const LINE_HEIGHT_MIN = 1.4;
const LINE_HEIGHT_MAX = 2.0;
const STORAGE_KEY = "mdedit.docsettings.v1";

function isTauriContext(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

function clamp(n: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, n));
}

function isHexColor(v: unknown): v is string {
  return typeof v === "string" && /^#[0-9a-fA-F]{6}$/.test(v);
}

/** 不正値はフィールド単位でデフォルトへフォールバックする。 */
export function validateDocSettings(raw: unknown): DocSettings {
  const d = DEFAULT_DOC_SETTINGS;
  if (typeof raw !== "object" || raw === null) return structuredClone(d);
  const obj = raw as Record<string, unknown>;
  const t = (typeof obj.theme === "object" && obj.theme !== null ? obj.theme : {}) as Record<
    string,
    unknown
  >;
  const dec = (typeof obj.decorations === "object" && obj.decorations !== null
    ? obj.decorations
    : {}) as Record<string, unknown>;

  const fontFamily = DOC_FONT_PRESETS.some((p) => p.id === t.fontFamily)
    ? (t.fontFamily as DocFontId)
    : d.theme.fontFamily;
  const fontSize =
    typeof t.fontSize === "number" && Number.isFinite(t.fontSize)
      ? clamp(Math.round(t.fontSize), FONT_SIZE_MIN, FONT_SIZE_MAX)
      : d.theme.fontSize;
  const lineHeight =
    typeof t.lineHeight === "number" && Number.isFinite(t.lineHeight)
      ? clamp(Math.round(t.lineHeight * 10) / 10, LINE_HEIGHT_MIN, LINE_HEIGHT_MAX)
      : d.theme.lineHeight;
  const headingStyle =
    t.headingStyle === "none" || t.headingStyle === "underline" || t.headingStyle === "left-border"
      ? t.headingStyle
      : d.theme.headingStyle;
  const highlightTheme =
    t.highlightTheme === "github" || t.highlightTheme === "atom-one-dark" || t.highlightTheme === "vs"
      ? t.highlightTheme
      : d.theme.highlightTheme;
  const mermaidTheme =
    t.mermaidTheme === "system" || t.mermaidTheme === "light" || t.mermaidTheme === "dark"
      ? t.mermaidTheme
      : d.theme.mermaidTheme;
  const mermaidFollowApp =
    typeof t.mermaidFollowApp === "boolean"
      ? t.mermaidFollowApp
      : d.theme.mermaidFollowApp;

  return {
    version: 1,
    theme: {
      fontFamily,
      fontSize,
      lineHeight,
      accentColor: isHexColor(t.accentColor) ? t.accentColor : d.theme.accentColor,
      textColor: isHexColor(t.textColor) ? t.textColor : d.theme.textColor,
      bgColor: isHexColor(t.bgColor) ? t.bgColor : d.theme.bgColor,
      headingStyle,
      highlightTheme,
      mermaidTheme,
      mermaidFollowApp,
    },
    decorations: {
      autoToc: typeof dec.autoToc === "boolean" ? dec.autoToc : d.decorations.autoToc,
      headingNumbers:
        typeof dec.headingNumbers === "boolean" ? dec.headingNumbers : d.decorations.headingNumbers,
      callouts: typeof dec.callouts === "boolean" ? dec.callouts : d.decorations.callouts,
      stripedTables:
        typeof dec.stripedTables === "boolean" ? dec.stripedTables : d.decorations.stripedTables,
    },
  };
}

export function docFontCss(id: DocFontId): string {
  return DOC_FONT_PRESETS.find((p) => p.id === id)?.css ?? DOC_FONT_PRESETS[0].css;
}

/** Mermaid配色設定を実際の "light" | "dark" に解決する（"system" はOS設定に追従）。 */
export function resolveMermaidScheme(setting: MermaidColorScheme): "light" | "dark" {
  if (setting === "light" || setting === "dark") return setting;
  const dark =
    typeof window !== "undefined" &&
    typeof window.matchMedia === "function" &&
    window.matchMedia("(prefers-color-scheme: dark)").matches;
  return dark ? "dark" : "light";
}

function hexToRgb(hex: string): { r: number; g: number; b: number } {
  return {
    r: parseInt(hex.slice(1, 3), 16),
    g: parseInt(hex.slice(3, 5), 16),
    b: parseInt(hex.slice(5, 7), 16),
  };
}

/**
 * 背景色が明るいか（輝度ベース）。HTML出力・印刷・プレビューで、Mermaid図の
 * 配色を文書背景に合わせる判定に使う（明るい背景→ライト図、暗い背景→ダーク図）。
 */
export function isLightColor(hex: string): boolean {
  if (!isHexColor(hex)) return true;
  const { r, g, b } = hexToRgb(hex);
  // ITU-R BT.601 輝度（0..255）。中間より明るければライト扱い。
  return 0.299 * r + 0.587 * g + 0.114 * b > 140;
}

function rgba(hex: string, alpha: number): string {
  const { r, g, b } = hexToRgb(hex);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

/**
 * テーマからCSSカスタムプロパティ宣言を生成する。
 * document.css はすべてこの変数を参照する。派生色（罫線・縞・コード背景）も
 * ここで計算して埋め込み、出力HTML側で color-mix() 等のモダンCSSに依存しない。
 */
export function docThemeCssVars(theme: DocTheme): string {
  return [
    `--doc-font-family: ${docFontCss(theme.fontFamily)};`,
    `--doc-font-size: ${theme.fontSize}px;`,
    `--doc-line-height: ${theme.lineHeight};`,
    `--doc-accent: ${theme.accentColor};`,
    `--doc-accent-soft: ${rgba(theme.accentColor, 0.5)};`,
    `--doc-accent-bg: ${rgba(theme.accentColor, 0.08)};`,
    `--doc-text: ${theme.textColor};`,
    `--doc-muted: ${rgba(theme.textColor, 0.62)};`,
    `--doc-border: ${rgba(theme.textColor, 0.18)};`,
    `--doc-border-soft: ${rgba(theme.textColor, 0.1)};`,
    `--doc-bg: ${theme.bgColor};`,
    `--doc-code-bg: ${rgba(theme.textColor, 0.055)};`,
    `--doc-stripe-bg: ${rgba(theme.textColor, 0.04)};`,
  ].join("\n");
}

/** 装飾トグルとテーマから、.document に付けるモディファイアクラスを返す。 */
export function docModifierClasses(settings: DocSettings): string[] {
  const cls: string[] = [];
  if (settings.theme.headingStyle === "underline") cls.push("heading-underline");
  if (settings.theme.headingStyle === "left-border") cls.push("heading-left-border");
  if (settings.decorations.headingNumbers) cls.push("numbered-headings");
  if (settings.decorations.stripedTables) cls.push("striped-tables");
  return cls;
}

// ── 永続化 ─────────────────────────────────────────────

const THEME_CHANGED_EVENT = "doc-theme-changed";

let current: DocSettings = structuredClone(DEFAULT_DOC_SETTINGS);
const listeners = new Set<(s: DocSettings) => void>();

function notify(): void {
  for (const fn of listeners) fn(current);
}

async function loadFromDisk(): Promise<DocSettings> {
  if (isTauriContext()) {
    try {
      const raw = await invoke<string | null>("load_settings");
      if (!raw) return structuredClone(DEFAULT_DOC_SETTINGS);
      return validateDocSettings(JSON.parse(raw));
    } catch (e) {
      console.warn("load_settings failed:", e);
      return structuredClone(DEFAULT_DOC_SETTINGS);
    }
  }
  // ブラウザ実行（vite dev単体）用フォールバック
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? validateDocSettings(JSON.parse(raw)) : structuredClone(DEFAULT_DOC_SETTINGS);
  } catch {
    return structuredClone(DEFAULT_DOC_SETTINGS);
  }
}

export const docTheme = {
  get(): DocSettings {
    return structuredClone(current);
  },

  /**
   * 保存せず現在値だけ更新して購読者へ通知する（設定モーダルの「プレビュー」用）。
   * これによりMermaid配色等の文書テーマも、適用前にライブ反映できる。
   * キャンセル時は呼び出し側が元の値で再度 previewLive して戻す。
   */
  previewLive(next: DocSettings): void {
    current = validateDocSettings(next);
    notify();
  },

  async save(next: DocSettings): Promise<void> {
    current = validateDocSettings(next);
    const json = JSON.stringify(current, null, 2);
    if (isTauriContext()) {
      await invoke<void>("save_settings", { json });
      // 他ウィンドウにも反映（マルチウィンドウ対応）
      void emit(THEME_CHANGED_EVENT, json).catch(() => {});
    } else {
      try {
        localStorage.setItem(STORAGE_KEY, json);
      } catch {
        // localStorage不可は黙って無視
      }
    }
    notify();
  },

  subscribe(fn: (s: DocSettings) => void): () => void {
    listeners.add(fn);
    return () => listeners.delete(fn);
  },

  /** ブートストラップ時に1回呼ぶ。ディスクから読み、他ウィンドウの変更を購読する。 */
  async init(): Promise<void> {
    current = await loadFromDisk();
    if (isTauriContext()) {
      await listen<string>(THEME_CHANGED_EVENT, (event) => {
        try {
          current = validateDocSettings(JSON.parse(event.payload));
          notify();
        } catch {
          // 壊れたペイロードは無視
        }
      });
    }
  },
};
