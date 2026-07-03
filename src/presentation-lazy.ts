// 起動バンドルから presentation.ts（および presentation.css）を切り離すための
// 遅延ロードシム。プレゼン／スライドショーは起動直後の編集には不要なため、
// 初回利用時にだけ動的importでロードする（Viteが別チャンクへ分割する）。
import type * as Presentation from "./presentation";

let mod: typeof Presentation | null = null;
// ロード前に登録予約された chrome 同期コールバック。ロード時に本物へ引き継ぐ。
let pendingChromeSync: (() => void) | null = null;

const load = async (): Promise<typeof Presentation> => {
  if (!mod) {
    mod = await import("./presentation");
    if (pendingChromeSync) mod.setPresentationChromeSync(pendingChromeSync);
  }
  return mod;
};

// ── アクション系（fire-and-forget。戻り値の boolean は呼び出し側で未使用）──
export async function startPresentation(
  tabId: string,
  fromStart: boolean,
): Promise<void> {
  (await load()).startPresentation(tabId, fromStart);
}

export async function togglePresentationView(tabId: string): Promise<void> {
  (await load()).togglePresentationView(tabId);
}

export async function togglePresentationLaser(tabId: string): Promise<void> {
  (await load()).togglePresentationLaser(tabId);
}

export async function selectPresentationSlide(
  tabId: string,
  index: number,
): Promise<void> {
  (await load()).selectPresentationSlide(tabId, index);
}

// 発表専用ウィンドウの起動予約（actions.ts の openMovedTab から使用）。
// mountPresentation より先に await して、マウント時に確実に自動発表させる。
export async function armPresentationWindow(opts: {
  index: number;
  openerLabel: string | null;
  sourceTabId: string | null;
}): Promise<void> {
  (await load()).armPresentationWindow(opts);
}

// スライドショープレビューのマウント（editor.ts の makePreview から使用）。
// makePreview は同期関数だが、container は先に DOM へ挿入済みのため、
// ロード完了後に中身を流し込めば足りる（初回マウント時のみ僅かな遅延）。
export function mountPresentation(
  container: HTMLElement,
  html: string,
  tabId: string,
): void {
  void load().then((m) => m.mountPresentation(container, html, tabId));
}

// ── クリーンアップ／同期述語（未ロード＝該当タブ未生成。安全側の既定値を返す）──
export function forgetPresentationState(tabId: string): void {
  mod?.forgetPresentationState(tabId);
}

export function isPresentationGridView(tabId: string): boolean {
  return mod?.isPresentationGridView(tabId) ?? false;
}

export function isPresentationFullscreen(tabId: string): boolean {
  return mod?.isPresentationFullscreen(tabId) ?? false;
}

export function getPresentationToolbar(tabId: string): HTMLElement | null {
  return mod?.getPresentationToolbar(tabId) ?? null;
}

// chrome 同期コールバックの登録。ロード前は予約しておき、ロード時に本物へ渡す。
export function setPresentationChromeSync(fn: () => void): void {
  pendingChromeSync = fn;
  if (mod) mod.setPresentationChromeSync(fn);
}
