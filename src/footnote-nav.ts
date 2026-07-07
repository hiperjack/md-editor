/**
 * エディタ内の脚注ジャンプ（Ctrl+クリック / Cmd+クリック）。
 *
 * 脚注はノード化せず常にテキストで扱うため（remark-footnote-text.ts）、
 * ジャンプ対象は footnote-pair.ts がペア成立箇所に付けるデコレーション
 * （.fn-pair-ref / .fn-pair-def、data-fn-label 属性）のみ。
 * 参照⇄定義を相互ジャンプし、到着先は一瞬ハイライトして視線を誘導する。
 */

const FLASH_CLASS = "footnote-jump-flash";

function jumpTo(el: Element | null): void {
  if (!el) return;
  el.scrollIntoView({ block: "center", behavior: "smooth" });
  el.classList.remove(FLASH_CLASS);
  // 再付与でアニメーションを確実に再生する。
  requestAnimationFrame(() => el.classList.add(FLASH_CLASS));
  setTimeout(() => el.classList.remove(FLASH_CLASS), 1600);
}

/** ラベルに対応するペア装飾要素を文書順で探す。 */
function findPairEl(
  root: Element,
  cls: "fn-pair-ref" | "fn-pair-def",
  label: string,
): Element | null {
  return root.querySelector(`.${cls}[data-fn-label="${CSS.escape(label)}"]`);
}

/** Ctrl/Cmd 押下中だけ脚注にポインターカーソルを出すための body クラス。 */
const CTRL_CLASS = "footnote-ctrl-down";

/** main.ts が起動時に1回呼ぶ。 */
export function installFootnoteNavigation(): void {
  // Ctrl（Mac は Cmd）押下中のみ、脚注の参照/定義ラベルをリンク風カーソルにする
  // （VS Code の Ctrl+クリックと同じ作法）。
  const setCtrl = (on: boolean): void => {
    document.body.classList.toggle(CTRL_CLASS, on);
  };
  document.addEventListener("keydown", (e) => {
    if (e.key === "Control" || e.key === "Meta") setCtrl(true);
  });
  document.addEventListener("keyup", (e) => {
    if (e.key === "Control" || e.key === "Meta") setCtrl(false);
  });
  window.addEventListener("blur", () => setCtrl(false));

  document.addEventListener(
    "click",
    (e) => {
      if (!e.ctrlKey && !e.metaKey) return;
      const target = e.target as Element | null;
      const editorRoot = target?.closest?.(".milkdown");
      if (!editorRoot) return;

      const pairEl = target?.closest?.(".fn-pair");
      if (!pairEl) return;
      e.preventDefault();
      e.stopPropagation();
      const label = pairEl.getAttribute("data-fn-label") ?? "";
      jumpTo(
        pairEl.classList.contains("fn-pair-ref")
          ? findPairEl(editorRoot, "fn-pair-def", label)
          : findPairEl(editorRoot, "fn-pair-ref", label),
      );
    },
    true,
  );
}
