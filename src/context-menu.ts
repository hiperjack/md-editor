/**
 * 汎用フローティングコンテキストメニュー。
 * find-bar と同じく #app 配下の専用ルートに DOM を挿入する。
 * showContextMenu でクリック座標に表示し、項目選択 / 外側クリック /
 * Esc / スクロール / リサイズ / ウィンドウ blur で閉じる。
 */

export type MenuItem =
  | {
      type: "item";
      label: string;
      action: () => void;
      disabled?: boolean;
      /** 右側に淡色で表示するショートカット表記（例: "F5", "Ctrl+P"）。 */
      shortcut?: string;
      /** ラベル左に表示するアイコン（信頼できるSVGマークアップのみ渡すこと）。 */
      icon?: string;
    }
  | { type: "separator" };

let rootEl: HTMLElement | null = null;
let menuEl: HTMLElement | null = null;
let cleanup: (() => void) | null = null;

function getRoot(): HTMLElement {
  if (rootEl) return rootEl;
  let el = document.getElementById("context-menu-root");
  if (!el) {
    el = document.createElement("div");
    el.id = "context-menu-root";
    (document.getElementById("app") ?? document.body).appendChild(el);
  }
  rootEl = el;
  return el;
}

/** 表示中のメニュー要素（未表示なら null）。ホバー開閉の判定に使う。 */
export function getContextMenuEl(): HTMLElement | null {
  return menuEl;
}

export function closeContextMenu(): void {
  if (cleanup) {
    cleanup();
    cleanup = null;
  }
  if (menuEl) {
    menuEl.remove();
    menuEl = null;
  }
}

export function showContextMenu(x: number, y: number, items: MenuItem[]): void {
  // 既存メニューがあれば閉じてから開き直す。
  closeContextMenu();

  const menu = document.createElement("div");
  menu.className = "context-menu";

  for (const item of items) {
    if (item.type === "separator") {
      const sep = document.createElement("div");
      sep.className = "context-menu__sep";
      menu.appendChild(sep);
      continue;
    }
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "context-menu__item";
    const labelSpan = document.createElement("span");
    labelSpan.className = "context-menu__label";
    if (item.icon) {
      // アイコン付き項目（ツールバーのオーバーフローメニュー等）。
      // icon は自前の ICONS 定数由来のSVGのみを想定する。
      const iconSpan = document.createElement("span");
      iconSpan.className = "context-menu__icon";
      iconSpan.innerHTML = item.icon;
      labelSpan.appendChild(iconSpan);
      labelSpan.appendChild(document.createTextNode(item.label));
    } else {
      labelSpan.textContent = item.label;
    }
    btn.appendChild(labelSpan);
    if (item.shortcut) {
      const accel = document.createElement("span");
      accel.className = "context-menu__accel";
      accel.textContent = item.shortcut;
      btn.appendChild(accel);
    }
    if (item.disabled) {
      btn.disabled = true;
    } else {
      // クリックでエディタのフォーカス/選択を失わないよう mousedown を抑止。
      btn.addEventListener("mousedown", (e) => e.preventDefault());
      btn.addEventListener("click", () => {
        closeContextMenu();
        item.action();
      });
    }
    menu.appendChild(btn);
  }

  // サイズ測定のため一旦不可視で配置 → 画面端でクランプ。
  menu.style.left = "0px";
  menu.style.top = "0px";
  menu.style.visibility = "hidden";
  // フルスクリーン中は、表示されるのが fullscreenElement のサブツリーだけのため、
  // メニューもその配下に入れないと見えない（発表モードの右クリック対応）。
  (document.fullscreenElement ?? getRoot()).appendChild(menu);
  menuEl = menu;

  const w = menu.offsetWidth;
  const h = menu.offsetHeight;
  const left = Math.max(4, Math.min(x, window.innerWidth - w - 4));
  const top = Math.max(4, Math.min(y, window.innerHeight - h - 4));
  menu.style.left = `${left}px`;
  menu.style.top = `${top}px`;
  menu.style.visibility = "visible";

  const onPointerDown = (e: MouseEvent) => {
    if (menuEl && !menuEl.contains(e.target as Node)) closeContextMenu();
  };
  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key === "Escape") {
      e.preventDefault();
      closeContextMenu();
    }
  };
  const onClose = () => closeContextMenu();

  // capture でドキュメント全体の mousedown を先に拾い、外側クリックで閉じる。
  document.addEventListener("mousedown", onPointerDown, true);
  document.addEventListener("keydown", onKeyDown, true);
  window.addEventListener("scroll", onClose, true);
  window.addEventListener("resize", onClose);
  window.addEventListener("blur", onClose);

  cleanup = () => {
    document.removeEventListener("mousedown", onPointerDown, true);
    document.removeEventListener("keydown", onKeyDown, true);
    window.removeEventListener("scroll", onClose, true);
    window.removeEventListener("resize", onClose);
    window.removeEventListener("blur", onClose);
  };
}
