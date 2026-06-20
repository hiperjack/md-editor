/**
 * HTMLプレビュー（読み取り専用の `.document`）の見出し折りたたみ。
 *
 * エディタの heading-fold と同様、見出し左の三角クリックでその配下（次の
 * 「同レベル以上の見出し」まで）を隠す。プレビューは静的HTMLのため DOM 操作で
 * 実現する。折りたたみは表示のみで保存・出力には影響しない（作り直すとリセット）。
 *
 * 状態の真実は「プレビュー本文の見出し要素に付く `pv-collapsed` クラス」。
 * 左パネル（アウトライン）はこの状態を読み書きして同期する（outline.ts）。
 */

/** H1〜H6 なら 1〜6、見出しでなければ 0。 */
export function headingLevelOf(tagName: string): number {
  const m = /^H([1-6])$/.exec(tagName);
  return m ? Number(m[1]) : 0;
}

/**
 * 各ブロックの (見出しレベル, 折りたたみ中か) 列から、各ブロックを隠すべきかを返す。
 * - 折りたたみ中の見出しは、次の「同レベル以上の見出し」までを隠す。
 * - 入れ子（外側が折りたたみ中なら内側の見出し・本文も隠す）にも対応する。
 * 見出しでないブロックは level=0 として渡す。
 */
export function computeHiddenFlags(
  items: { level: number; collapsed: boolean }[],
): boolean[] {
  const hidden: boolean[] = [];
  let activeCollapseLevel: number | null = null;
  for (const item of items) {
    if (item.level > 0) {
      if (activeCollapseLevel !== null && item.level <= activeCollapseLevel) {
        activeCollapseLevel = null;
      }
      const h = activeCollapseLevel !== null;
      hidden.push(h);
      if (!h && item.collapsed) activeCollapseLevel = item.level;
    } else {
      hidden.push(activeCollapseLevel !== null);
    }
  }
  return hidden;
}

// 折りたたみ変化（プレビュー三角クリック・アウトライン操作の双方）を購読する。
const foldChangeListeners = new Set<() => void>();

/** 折りたたみ変化を購読する。解除関数を返す（アウトライン同期用）。 */
export function onPreviewFoldChange(cb: () => void): () => void {
  foldChangeListeners.add(cb);
  return () => foldChangeListeners.delete(cb);
}

function notifyFoldChange(): void {
  for (const cb of foldChangeListeners) cb();
}

/** 表示中（#editor-host 配下）のプレビュー本文 `.document` を返す。無ければ null。 */
function activePreviewDoc(): HTMLElement | null {
  return document.querySelector<HTMLElement>(
    "#editor-host .editor-pane.preview-pane .document",
  );
}

/** `.document` 直下のフラットな子要素のうち見出しだけを順に返す。 */
function headingChildrenOf(doc: HTMLElement): HTMLElement[] {
  return (Array.from(doc.children) as HTMLElement[]).filter(
    (el) => headingLevelOf(el.tagName) > 0,
  );
}

/** 表示中プレビューの見出し要素（文書順）。アウトラインと共有する。 */
export function getPreviewHeadings(): HTMLElement[] {
  const doc = activePreviewDoc();
  return doc ? headingChildrenOf(doc) : [];
}

/** 表示中プレビューで折りたたみ中の見出しインデックス（文書順）。 */
export function getPreviewCollapsedIndices(): Set<number> {
  const set = new Set<number>();
  getPreviewHeadings().forEach((h, i) => {
    if (h.classList.contains("pv-collapsed")) set.add(i);
  });
  return set;
}

/** 指定 `.document` の隠し状態を、見出しの pv-collapsed から再計算して反映する。 */
function recomputeFold(doc: HTMLElement): void {
  const children = Array.from(doc.children) as HTMLElement[];
  const flags = computeHiddenFlags(
    children.map((el) => ({
      level: headingLevelOf(el.tagName),
      collapsed: el.classList.contains("pv-collapsed"),
    })),
  );
  children.forEach((el, i) => el.classList.toggle("pv-folded-hidden", flags[i]));
}

/** 文書順 index の見出しの折りたたみをトグルする（アウトラインから呼ぶ）。 */
export function togglePreviewFoldByIndex(index: number): void {
  const doc = activePreviewDoc();
  if (!doc) return;
  const headings = headingChildrenOf(doc);
  const h = headings[index];
  if (!h) return;
  h.classList.toggle("pv-collapsed");
  recomputeFold(doc);
  notifyFoldChange();
}

/**
 * プレビューペイン要素に見出し折りたたみを取り付ける。
 * `.document` 直下のフラットな兄弟（見出し・本文）を対象にする。
 */
export function attachPreviewFold(paneRoot: HTMLElement): void {
  const doc = paneRoot.querySelector<HTMLElement>(".document") ?? paneRoot;
  const children = Array.from(doc.children) as HTMLElement[];
  if (children.length === 0) return;

  for (const child of children) {
    if (headingLevelOf(child.tagName) === 0) continue;
    if (child.querySelector(":scope > .pv-fold-toggle")) continue;
    child.classList.add("pv-foldable");
    const toggle = document.createElement("span");
    toggle.className = "pv-fold-toggle";
    toggle.setAttribute("aria-hidden", "true");
    toggle.addEventListener("mousedown", (e) => {
      e.preventDefault();
      e.stopPropagation();
      child.classList.toggle("pv-collapsed");
      recomputeFold(doc);
      notifyFoldChange();
    });
    child.insertBefore(toggle, child.firstChild);
  }

  recomputeFold(doc);
}
