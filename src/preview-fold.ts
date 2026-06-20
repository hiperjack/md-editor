/**
 * HTMLプレビュー（読み取り専用の `.document`）に見出し折りたたみを付ける。
 *
 * エディタの heading-fold と同様、見出し左の三角をクリックすると、その配下
 * （次の「同レベル以上の見出し」まで）を隠す。プレビューは静的HTMLのため、
 * ProseMirror decoration ではなく DOM 操作で実現する。折りたたみは表示のみで、
 * 保存・HTML出力には影響しない（プレビューを作り直すと状態はリセットされる）。
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
      // 同レベル以上の見出しが来たら、現在の折りたたみ範囲は終了する。
      if (activeCollapseLevel !== null && item.level <= activeCollapseLevel) {
        activeCollapseLevel = null;
      }
      const h = activeCollapseLevel !== null;
      hidden.push(h);
      // 表示中かつ自身が折りたたみ中なら、新しい折りたたみ範囲を開始する。
      if (!h && item.collapsed) activeCollapseLevel = item.level;
    } else {
      hidden.push(activeCollapseLevel !== null);
    }
  }
  return hidden;
}

/**
 * プレビューペイン要素に見出し折りたたみを取り付ける。
 * `.document` 直下のフラットな兄弟（見出し・本文）を対象にする。
 */
export function attachPreviewFold(paneRoot: HTMLElement): void {
  const doc = paneRoot.querySelector<HTMLElement>(".document") ?? paneRoot;
  const children = Array.from(doc.children) as HTMLElement[];
  if (children.length === 0) return;

  const recompute = () => {
    const flags = computeHiddenFlags(
      children.map((el) => ({
        level: headingLevelOf(el.tagName),
        collapsed: el.classList.contains("pv-collapsed"),
      })),
    );
    children.forEach((el, i) => {
      el.classList.toggle("pv-folded-hidden", flags[i]);
    });
  };

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
      recompute();
    });
    child.insertBefore(toggle, child.firstChild);
  }

  recompute();
}
