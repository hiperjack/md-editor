/**
 * エディタ内の脚注ジャンプ（Ctrl+クリック / Cmd+クリック）。
 *
 * WYSIWYG エディタ内の脚注参照（sup[data-type="footnote_reference"]）を
 * Ctrl+クリックすると対応する定義（dl[data-type="footnote_definition"]）へ、
 * 定義側を Ctrl+クリックすると最初の参照へスクロールして相互ジャンプする。
 * 到着先は一瞬ハイライトして視線を誘導する。
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

/** ラベルに対応する参照要素（ノード化済み or デコレーション）を文書順で探す。 */
function findRefEl(root: Element, label: string): Element | null {
  const esc = CSS.escape(label);
  return root.querySelector(
    `sup[data-type="footnote_reference"][data-label="${esc}"], .fn-pair-ref[data-fn-label="${esc}"]`,
  );
}

/** ラベルに対応する定義要素（ノード化済み or デコレーション）を文書順で探す。 */
function findDefEl(root: Element, label: string): Element | null {
  const esc = CSS.escape(label);
  return root.querySelector(
    `dl[data-type="footnote_definition"][data-label="${esc}"], .fn-pair-def[data-fn-label="${esc}"]`,
  );
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

      // 手入力ペアのデコレーション（footnote-pair.ts が付与）。
      const pairEl = target?.closest?.(".fn-pair");
      if (pairEl) {
        e.preventDefault();
        e.stopPropagation();
        const label = pairEl.getAttribute("data-fn-label") ?? "";
        jumpTo(
          pairEl.classList.contains("fn-pair-ref")
            ? findDefEl(editorRoot, label)
            : findRefEl(editorRoot, label),
        );
        return;
      }

      const ref = target?.closest?.('sup[data-type="footnote_reference"]');
      if (ref) {
        // ペアが崩れた脚注はジャンプ先が無いので何もしない。
        if (ref.classList.contains("fn-unpaired")) return;
        e.preventDefault();
        e.stopPropagation();
        jumpTo(findDefEl(editorRoot, ref.getAttribute("data-label") ?? ""));
        return;
      }

      const def = target?.closest?.('dl[data-type="footnote_definition"]');
      if (def) {
        if (def.classList.contains("fn-unpaired")) return;
        e.preventDefault();
        e.stopPropagation();
        jumpTo(findRefEl(editorRoot, def.getAttribute("data-label") ?? ""));
      }
    },
    true,
  );
}
