/**
 * Claude使用量（サブスクの5h/7dレートリミット等）の取得と表示ヘルパー。
 * データ源は Rust の chat_usage コマンド（~/.claude の OAuth トークンで
 * usage エンドポイントを叩き、レスポンス JSON を文字列のまま返す）。
 * リング文字と配色は Claude Code statusline と同じ規則に合わせている。
 */
import { invoke } from "@tauri-apps/api/core";

export type UsageWindow = { utilization: number; resetsAt: string | null };
export type ScopedLimit = {
  label: string;
  percent: number;
  resetsAt: string | null;
};
export type UsageData = {
  fiveHour: UsageWindow | null;
  sevenDay: UsageWindow | null;
  scoped: ScopedLimit[];
};

type RawWindow = { utilization?: number; resets_at?: string | null } | null;
type RawLimit = {
  percent?: number;
  resets_at?: string | null;
  scope?: { model?: { display_name?: string | null } | null } | null;
};
type RawUsage = {
  five_hour?: RawWindow;
  seven_day?: RawWindow;
  limits?: RawLimit[] | null;
};

/** usage エンドポイントのレスポンス JSON をパースする。不正JSONは例外。 */
export function parseUsage(raw: string): UsageData {
  const j = JSON.parse(raw) as RawUsage;
  const win = (w: RawWindow | undefined): UsageWindow | null =>
    typeof w?.utilization === "number"
      ? { utilization: w.utilization, resetsAt: w.resets_at ?? null }
      : null;
  // 5h/7d と重複する session / weekly_all は捨て、モデル別
  // （scope.model.display_name あり）の上限だけを拾う。
  const scoped: ScopedLimit[] = (j.limits ?? [])
    .filter(
      (l): l is RawLimit & { percent: number } =>
        typeof l?.percent === "number" && !!l.scope?.model?.display_name,
    )
    .map((l) => ({
      label: l.scope!.model!.display_name!,
      percent: l.percent,
      resetsAt: l.resets_at ?? null,
    }));
  return { fiveHour: win(j.five_hour), sevenDay: win(j.seven_day), scoped };
}

const RINGS = ["○", "◔", "◑", "◕", "●"];

/** 使用率(%)を25%刻みのリング文字にする。 */
export function ringChar(p: number): string {
  return RINGS[Math.max(0, Math.min(Math.floor(p / 25), 4))];
}

/** 使用率(%)を緑→黄→赤の CSS 色にする（statusline と同じ式）。 */
export function ringColor(p: number): string {
  if (p < 50) return `rgb(${Math.round(p * 5.1)},200,80)`;
  const g = Math.max(0, Math.round(200 - (p - 50) * 4));
  return `rgb(255,${g},60)`;
}

/** リセット時刻をローカル時刻 "M/D HH:MM" で整形。null・不正値は空文字。 */
export function fmtReset(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const h = String(d.getHours()).padStart(2, "0");
  const m = String(d.getMinutes()).padStart(2, "0");
  return `${d.getMonth() + 1}/${d.getDate()} ${h}:${m}`;
}

/** invoke エラーを表示用の i18n キーへ変換する。 */
export function usageErrorKey(e: unknown): "usage.errAuth" | "usage.errFetch" {
  const s = String(e);
  return s.includes("no-credentials") || s.includes("unauthorized")
    ? "usage.errAuth"
    : "usage.errFetch";
}

/** 連続 chat-done での連打を防ぐ短期キャッシュ。 */
const CACHE_MS = 60_000;
let cache: { data: UsageData; at: number } | null = null;

/** 使用量を取得する（60秒キャッシュ）。force=true でキャッシュ無視。 */
export async function fetchUsage(force = false): Promise<UsageData> {
  if (!force && cache && Date.now() - cache.at < CACHE_MS) return cache.data;
  const data = parseUsage(await invoke<string>("chat_usage"));
  cache = { data, at: Date.now() };
  return data;
}
