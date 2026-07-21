export type FontPreset = {
  /** i18n キー。実表示は t(labelKey) で解決する。 */
  labelKey: string;
  /** CSS font-family 値 */
  value: string;
};

/**
 * 日本語環境で使いやすいフォントの候補。
 * 値はCSS font-family 文字列そのまま。
 */
export const FONT_PRESETS: FontPreset[] = [
  {
    labelKey: "font.preset.systemDefault",
    value:
      "system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', 'Yu Gothic UI', Meiryo, sans-serif",
  },
  {
    labelKey: "font.preset.yuGothicUI",
    value: "'Yu Gothic UI', 'Yu Gothic', YuGothic, sans-serif",
  },
  { labelKey: "font.preset.meiryo", value: "Meiryo, sans-serif" },
  {
    labelKey: "font.preset.msPGothic",
    value: "'MS PGothic', 'MS Gothic', sans-serif",
  },
  {
    labelKey: "font.preset.notoSansJP",
    value: "'Noto Sans JP', 'Noto Sans CJK JP', sans-serif",
  },
  {
    labelKey: "font.preset.yuMincho",
    value: "'Yu Mincho', YuMincho, 'Hiragino Mincho ProN', serif",
  },
  { labelKey: "font.preset.msPMincho", value: "'MS PMincho', 'MS Mincho', serif" },
  {
    labelKey: "font.preset.cascadiaCode",
    value: "'Cascadia Code', 'Cascadia Mono', Consolas, monospace",
  },
  {
    labelKey: "font.preset.consolas",
    value: "Consolas, 'Courier New', monospace",
  },
];

import type { Lang } from "./i18n";

export type Theme = "dark" | "light" | "system";

/** 言語設定。"system" は navigator.language から ja/en に解決する。 */
export type LangSetting = Lang | "system";

export type Settings = {
  fontFamily: string;
  codeFontFamily: string;
  /** 空文字なら本文色に追従。CSS color 値が入っていればその色で上書き。 */
  codeFontColor: string;
  fontSize: number;
  showRecent: boolean;
  /** 左の見出しアウトラインパネルを表示するか。 */
  showOutline: boolean;
  /**
   * Claudeチャット機能を使うか。オフでツールバーアイコン・メニュー項目ごと
   * 非表示になる（Claudeアカウントを持たない利用者向け）。
   * パネルの開閉状態は永続化しない（起動時は常に非表示）。
   */
  chatEnabled: boolean;
  /** ClaudeチャットでWeb検索（WebSearch/WebFetch）を許可するか。 */
  chatWebSearch: boolean;
  /** チャットパネルのヘッダーに使用量（5h/7d）を常駐表示するか。 */
  chatUsageInHeader: boolean;
  lang: LangSetting;
  theme: Theme;
  /** 左アウトラインパネルの横幅(px)。150〜600 にクランプ。 */
  outlineWidth: number;
  /** 右チャットパネルの横幅(px)。240〜700 にクランプ。 */
  chatPanelWidth: number;
  /** エディタ内Mermaidプレビューの表示幅モード。fit=エディタ幅に縮小, native=原寸+横スクロール。 */
  mermaidWidthMode: "fit" | "native";
  /** ガント表示スタイル（文書系: エディタプレビュー・HTML出力・印刷）。 */
  ganttStyleDocument: "mermaid" | "ppt";
  /** ガント表示スタイル（スライド系: プレゼン・スライドHTML/PDF出力）。 */
  ganttStyleSlide: "mermaid" | "ppt";
  /** 文字色ボタンが直近に適用した色（"#rrggbb"）。ボタン本体クリックで再適用する。 */
  lastTextColor: string;
  /** ハイライトボタンが直近に適用した色。"" は標準マーカー（属性なし <mark>）。 */
  lastHighlightColor: string;
};

const DEFAULT_SETTINGS: Settings = {
  fontFamily: FONT_PRESETS[0].value,
  codeFontFamily: FONT_PRESETS[0].value,
  codeFontColor: "",
  fontSize: 15,
  showRecent: true,
  showOutline: false,
  chatEnabled: false,
  chatWebSearch: true,
  chatUsageInHeader: true,
  lang: "system",
  theme: "system",
  outlineWidth: 250,
  chatPanelWidth: 320,
  mermaidWidthMode: "fit",
  ganttStyleDocument: "mermaid",
  ganttStyleSlide: "mermaid",
  lastTextColor: "#ff0000",
  lastHighlightColor: "",
};

const MIN_SIZE = 8;
const MAX_SIZE = 48;
const MIN_OUTLINE_WIDTH = 150;
const MAX_OUTLINE_WIDTH = 600;

function clampOutlineWidth(n: number): number {
  return Math.max(MIN_OUTLINE_WIDTH, Math.min(MAX_OUTLINE_WIDTH, Math.round(n)));
}

const MIN_CHAT_WIDTH = 240;
const MAX_CHAT_WIDTH = 700;

/** チャットパネル幅のクランプ。リサイザのライブ反映（chat-panel.ts）とも共用する。 */
export function clampChatWidth(n: number): number {
  return Math.max(MIN_CHAT_WIDTH, Math.min(MAX_CHAT_WIDTH, Math.round(n)));
}

const STORAGE_KEY = "mdedit.settings.v1";

function loadFromStorage(): Settings {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { ...DEFAULT_SETTINGS };
    const parsed = JSON.parse(raw) as Partial<Settings>;
    return {
      fontFamily:
        typeof parsed.fontFamily === "string" && parsed.fontFamily
          ? parsed.fontFamily
          : DEFAULT_SETTINGS.fontFamily,
      codeFontFamily:
        typeof parsed.codeFontFamily === "string" && parsed.codeFontFamily
          ? parsed.codeFontFamily
          : DEFAULT_SETTINGS.codeFontFamily,
      codeFontColor:
        typeof parsed.codeFontColor === "string"
          ? parsed.codeFontColor
          : DEFAULT_SETTINGS.codeFontColor,
      fontSize:
        typeof parsed.fontSize === "number" && Number.isFinite(parsed.fontSize)
          ? clampSize(parsed.fontSize)
          : DEFAULT_SETTINGS.fontSize,
      showRecent:
        typeof parsed.showRecent === "boolean"
          ? parsed.showRecent
          : DEFAULT_SETTINGS.showRecent,
      showOutline:
        typeof parsed.showOutline === "boolean"
          ? parsed.showOutline
          : DEFAULT_SETTINGS.showOutline,
      chatEnabled:
        typeof parsed.chatEnabled === "boolean"
          ? parsed.chatEnabled
          : DEFAULT_SETTINGS.chatEnabled,
      chatWebSearch:
        typeof parsed.chatWebSearch === "boolean"
          ? parsed.chatWebSearch
          : DEFAULT_SETTINGS.chatWebSearch,
      chatUsageInHeader:
        typeof parsed.chatUsageInHeader === "boolean"
          ? parsed.chatUsageInHeader
          : DEFAULT_SETTINGS.chatUsageInHeader,
      lang:
        parsed.lang === "ja" ||
        parsed.lang === "en" ||
        parsed.lang === "system"
          ? parsed.lang
          : DEFAULT_SETTINGS.lang,
      theme:
        parsed.theme === "dark" ||
        parsed.theme === "light" ||
        parsed.theme === "system"
          ? parsed.theme
          : DEFAULT_SETTINGS.theme,
      outlineWidth:
        typeof parsed.outlineWidth === "number" &&
        Number.isFinite(parsed.outlineWidth)
          ? clampOutlineWidth(parsed.outlineWidth)
          : DEFAULT_SETTINGS.outlineWidth,
      chatPanelWidth:
        typeof parsed.chatPanelWidth === "number" &&
        Number.isFinite(parsed.chatPanelWidth)
          ? clampChatWidth(parsed.chatPanelWidth)
          : DEFAULT_SETTINGS.chatPanelWidth,
      mermaidWidthMode:
        parsed.mermaidWidthMode === "fit" || parsed.mermaidWidthMode === "native"
          ? parsed.mermaidWidthMode
          : DEFAULT_SETTINGS.mermaidWidthMode,
      ganttStyleDocument:
        parsed.ganttStyleDocument === "mermaid" ||
        parsed.ganttStyleDocument === "ppt"
          ? parsed.ganttStyleDocument
          : DEFAULT_SETTINGS.ganttStyleDocument,
      ganttStyleSlide:
        parsed.ganttStyleSlide === "mermaid" || parsed.ganttStyleSlide === "ppt"
          ? parsed.ganttStyleSlide
          : DEFAULT_SETTINGS.ganttStyleSlide,
      lastTextColor:
        typeof parsed.lastTextColor === "string" &&
        /^#[0-9a-fA-F]{6}$/.test(parsed.lastTextColor)
          ? parsed.lastTextColor
          : DEFAULT_SETTINGS.lastTextColor,
      lastHighlightColor:
        typeof parsed.lastHighlightColor === "string" &&
        (parsed.lastHighlightColor === "" ||
          /^#[0-9a-fA-F]{6}$/.test(parsed.lastHighlightColor))
          ? parsed.lastHighlightColor
          : DEFAULT_SETTINGS.lastHighlightColor,
    };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

function saveToStorage(s: Settings): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(s));
  } catch {
    // localStorage不可（プライベートモード等）の場合は黙って無視
  }
}

function clampSize(n: number): number {
  return Math.max(MIN_SIZE, Math.min(MAX_SIZE, Math.round(n)));
}

let current: Settings = loadFromStorage();
const listeners = new Set<(s: Settings) => void>();

/**
 * OS のライト/ダーク設定を見るメディアクエリ。
 * theme=system のときに data-theme をこの値に追従させる。
 */
const systemDarkMql =
  typeof window !== "undefined" && typeof window.matchMedia === "function"
    ? window.matchMedia("(prefers-color-scheme: dark)")
    : null;

function effectiveTheme(): "dark" | "light" {
  if (current.theme === "dark") return "dark";
  if (current.theme === "light") return "light";
  // system: OSがダーク指定 → dark、それ以外 → light（matchMediaが無い古い環境はlight扱い）
  return systemDarkMql?.matches ? "dark" : "light";
}

/**
 * 言語設定を実際の Lang ("ja"|"en") に解決する。
 * "system" は navigator.language を見て ja で始まれば ja、それ以外は en にマップ。
 * navigator が無い (SSR等) 場合は ja にフォールバック。
 */
function effectiveLang(): Lang {
  if (current.lang === "ja" || current.lang === "en") return current.lang;
  const sys =
    typeof navigator !== "undefined" && typeof navigator.language === "string"
      ? navigator.language
      : "";
  return sys.toLowerCase().startsWith("ja") ? "ja" : "en";
}

function applyToDom(): void {
  const root = document.documentElement;
  root.style.setProperty("--editor-font-family", current.fontFamily);
  root.style.setProperty("--editor-code-font-family", current.codeFontFamily);
  root.style.setProperty(
    "--editor-code-color",
    current.codeFontColor || "inherit",
  );
  root.style.setProperty("--editor-font-size", `${current.fontSize}px`);
  root.setAttribute("data-theme", effectiveTheme());
  root.style.setProperty("--outline-w", `${current.outlineWidth}px`);
  root.style.setProperty("--chat-w", `${current.chatPanelWidth}px`);
  root.setAttribute("data-mermaid-width", current.mermaidWidthMode);
  // ツールバーの文字色/ハイライトボタンのカラーバーが参照する。
  root.style.setProperty("--last-text-color", current.lastTextColor);
  root.style.setProperty(
    "--last-highlight-color",
    current.lastHighlightColor || "#ffff00",
  );
}

function notify(): void {
  for (const fn of listeners) fn(current);
}

export const settings = {
  get(): Settings {
    return { ...current };
  },

  setFontFamily(v: string): void {
    if (!v || v === current.fontFamily) return;
    current = { ...current, fontFamily: v };
    saveToStorage(current);
    applyToDom();
    notify();
  },

  setCodeFontFamily(v: string): void {
    if (!v || v === current.codeFontFamily) return;
    current = { ...current, codeFontFamily: v };
    saveToStorage(current);
    applyToDom();
    notify();
  },

  setCodeFontColor(v: string): void {
    if (v === current.codeFontColor) return;
    current = { ...current, codeFontColor: v };
    saveToStorage(current);
    applyToDom();
    notify();
  },

  setFontSize(v: number): void {
    const next = clampSize(v);
    if (next === current.fontSize) return;
    current = { ...current, fontSize: next };
    saveToStorage(current);
    applyToDom();
    notify();
  },

  changeFontSize(delta: number): void {
    settings.setFontSize(current.fontSize + delta);
  },

  resetFontSize(): void {
    settings.setFontSize(DEFAULT_SETTINGS.fontSize);
  },

  setShowRecent(v: boolean): void {
    if (v === current.showRecent) return;
    current = { ...current, showRecent: v };
    saveToStorage(current);
    notify();
  },

  setShowOutline(v: boolean): void {
    if (v === current.showOutline) return;
    current = { ...current, showOutline: v };
    saveToStorage(current);
    notify();
  },

  toggleOutline(): void {
    settings.setShowOutline(!current.showOutline);
  },

  setChatEnabled(v: boolean): void {
    if (v === current.chatEnabled) return;
    current = { ...current, chatEnabled: v };
    saveToStorage(current);
    notify();
  },

  setChatWebSearch(v: boolean): void {
    if (v === current.chatWebSearch) return;
    current = { ...current, chatWebSearch: v };
    saveToStorage(current);
    notify();
  },

  setChatUsageInHeader(v: boolean): void {
    if (v === current.chatUsageInHeader) return;
    current = { ...current, chatUsageInHeader: v };
    saveToStorage(current);
    notify();
  },

  setChatPanelWidth(v: number): void {
    const next = clampChatWidth(v);
    if (next === current.chatPanelWidth) return;
    current = { ...current, chatPanelWidth: next };
    saveToStorage(current);
    applyToDom();
    notify();
  },

  setLang(v: LangSetting): void {
    if (v === current.lang) return;
    current = { ...current, lang: v };
    saveToStorage(current);
    notify();
  },

  /** 言語設定を解決済みの "ja"|"en" として取得。 */
  getEffectiveLang(): Lang {
    return effectiveLang();
  },

  /** 表示テーマを解決済みの "dark"|"light" として取得（Mermaid配色の連動に使う）。 */
  getEffectiveTheme(): "dark" | "light" {
    return effectiveTheme();
  },

  setTheme(v: Theme): void {
    if (v === current.theme) return;
    current = { ...current, theme: v };
    saveToStorage(current);
    applyToDom();
    notify();
  },

  setOutlineWidth(v: number): void {
    const next = clampOutlineWidth(v);
    if (next === current.outlineWidth) return;
    current = { ...current, outlineWidth: next };
    saveToStorage(current);
    applyToDom();
    notify();
  },

  setLastTextColor(v: string): void {
    if (!/^#[0-9a-fA-F]{6}$/.test(v) || v === current.lastTextColor) return;
    current = { ...current, lastTextColor: v };
    saveToStorage(current);
    applyToDom();
    notify();
  },

  /** "" は標準マーカー（属性なし <mark>）。 */
  setLastHighlightColor(v: string): void {
    if (v !== "" && !/^#[0-9a-fA-F]{6}$/.test(v)) return;
    if (v === current.lastHighlightColor) return;
    current = { ...current, lastHighlightColor: v };
    saveToStorage(current);
    applyToDom();
    notify();
  },

  setMermaidWidthMode(v: "fit" | "native"): void {
    if (v === current.mermaidWidthMode) return;
    current = { ...current, mermaidWidthMode: v };
    saveToStorage(current);
    applyToDom();
    notify();
  },

  setGanttStyleDocument(v: "mermaid" | "ppt"): void {
    if (v === current.ganttStyleDocument) return;
    current = { ...current, ganttStyleDocument: v };
    saveToStorage(current);
    notify();
  },

  setGanttStyleSlide(v: "mermaid" | "ppt"): void {
    if (v === current.ganttStyleSlide) return;
    current = { ...current, ganttStyleSlide: v };
    saveToStorage(current);
    notify();
  },

  subscribe(fn: (s: Settings) => void): () => void {
    listeners.add(fn);
    return () => listeners.delete(fn);
  },

  /** ブートストラップ時に1回呼ぶ。 */
  init(): void {
    applyToDom();
    // theme=system のとき、OS のライト/ダーク変更にライブで追従する。
    systemDarkMql?.addEventListener("change", () => {
      if (current.theme === "system") {
        applyToDom();
        notify();
      }
    });
  },
};
