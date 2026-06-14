/**
 * HTML製のメニューバー（ファイル/編集/書式/表示/ヘルプ）。
 *
 * ネイティブメニューは WebView2 で Alt ニーモニックが効かないため、メニューを
 * HTMLで自前描画し、Alt+文字でのメニュー操作をJSで実装する。
 *
 * 操作:
 *  - クリックでメニュー開閉、開いている間に別のトップへホバーで切替。
 *  - Alt+文字 でトップメニューを開く（例: Alt+F でファイル）。
 *  - 開いている間: 上下で項目移動、左右でメニュー切替、Enter で実行、Esc で閉じる、
 *    文字キーでその項目のニーモニックを直接実行（例: Alt+F → N で新規タブ）。
 */

export type MenuEntry =
  | {
      type: "item";
      label: string;
      /** ニーモニック1文字（大文字小文字問わず）。 */
      mnemonic?: string;
      /** 右側に表示するショートカット表記（例: "Ctrl+N"）。 */
      accel?: string;
      run: () => void;
      /** false を返すと淡色・実行不可。 */
      enabled?: () => boolean;
    }
  | { type: "sep" };

export interface TopMenu {
  id: string;
  label: string;
  mnemonic: string;
  /** 開くたびに呼ばれ、項目を動的に組み立てる（最近のファイル・活性状態など）。 */
  items: () => MenuEntry[];
  /** items() の前に呼ばれる。最近ファイル一覧の取得など非同期準備に使う。 */
  onOpen?: () => void | Promise<void>;
}

export interface MenuBarHandle {
  destroy(): void;
  /** メニューが開いているか（他のキーハンドラと競合回避に使う）。 */
  isOpen(): boolean;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** ラベル中のニーモニック文字に下線を付ける。無ければ "(X)" を末尾に付す。 */
function labelHtml(label: string, mnemonic?: string): string {
  const esc = escapeHtml(label);
  if (!mnemonic) return esc;
  const i = label.toLowerCase().indexOf(mnemonic.toLowerCase());
  if (i >= 0) {
    return (
      escapeHtml(label.slice(0, i)) +
      "<u>" +
      escapeHtml(label.slice(i, i + 1)) +
      "</u>" +
      escapeHtml(label.slice(i + 1))
    );
  }
  return `${esc}(<u>${escapeHtml(mnemonic.toUpperCase())}</u>)`;
}

export function createMenuBar(
  parent: HTMLElement,
  menus: TopMenu[],
  opts?: { onClose?: () => void },
): MenuBarHandle {
  parent.innerHTML = "";
  parent.classList.add("menubar");

  let openIndex = -1;
  let highlight = -1;
  let currentEntries: MenuEntry[] = [];
  let dropdown: HTMLElement | null = null;

  const topButtons: HTMLButtonElement[] = menus.map((m, idx) => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "menubar-top";
    btn.innerHTML = labelHtml(m.label, m.mnemonic);
    btn.addEventListener("mousedown", (e) => {
      e.preventDefault();
      if (openIndex === idx) closeMenu();
      else void openMenu(idx);
    });
    btn.addEventListener("mouseenter", () => {
      // いずれかが開いている間は、ホバーで開くメニューを切り替える。
      if (openIndex >= 0 && openIndex !== idx) void openMenu(idx);
    });
    parent.appendChild(btn);
    return btn;
  });

  const enabledIndexes = (): number[] =>
    currentEntries
      .map((e, i) => ({ e, i }))
      .filter(
        ({ e }) => e.type === "item" && (!e.enabled || e.enabled()),
      )
      .map(({ i }) => i);

  const renderHighlight = () => {
    if (!dropdown) return;
    const rows = dropdown.querySelectorAll<HTMLElement>(".menubar-item");
    rows.forEach((row) => {
      const i = Number(row.dataset.index);
      row.classList.toggle("highlight", i === highlight);
    });
  };

  const buildDropdown = (idx: number) => {
    const dd = document.createElement("div");
    dd.className = "menubar-dropdown";
    currentEntries.forEach((entry, i) => {
      if (entry.type === "sep") {
        const sep = document.createElement("div");
        sep.className = "menubar-sep";
        dd.appendChild(sep);
        return;
      }
      const enabled = !entry.enabled || entry.enabled();
      const row = document.createElement("div");
      row.className = "menubar-item" + (enabled ? "" : " disabled");
      row.dataset.index = String(i);
      const label = document.createElement("span");
      label.className = "menubar-item-label";
      label.innerHTML = labelHtml(entry.label, entry.mnemonic);
      row.appendChild(label);
      if (entry.accel) {
        const accel = document.createElement("span");
        accel.className = "menubar-item-accel";
        accel.textContent = entry.accel;
        row.appendChild(accel);
      }
      if (enabled) {
        row.addEventListener("mouseenter", () => {
          highlight = i;
          renderHighlight();
        });
        row.addEventListener("mousedown", (e) => {
          e.preventDefault();
        });
        row.addEventListener("click", (e) => {
          e.preventDefault();
          activate(entry);
        });
      }
      dd.appendChild(row);
    });
    // トップボタンの真下に配置する。
    dd.style.left = `${topButtons[idx].offsetLeft}px`;
    parent.appendChild(dd);
    return dd;
  };

  const openMenu = async (idx: number) => {
    const menu = menus[idx];
    if (!menu) return;
    if (dropdown) {
      dropdown.remove();
      dropdown = null;
    }
    await menu.onOpen?.();
    currentEntries = menu.items();
    openIndex = idx;
    topButtons.forEach((b, i) => b.classList.toggle("active", i === idx));
    dropdown = buildDropdown(idx);
    highlight = -1;
    renderHighlight();
  };

  const closeMenu = (restoreFocus = true) => {
    if (dropdown) {
      dropdown.remove();
      dropdown = null;
    }
    openIndex = -1;
    highlight = -1;
    currentEntries = [];
    topButtons.forEach((b) => b.classList.remove("active"));
    if (restoreFocus) opts?.onClose?.();
  };

  const activate = (entry: MenuEntry) => {
    if (entry.type !== "item") return;
    if (entry.enabled && !entry.enabled()) return;
    closeMenu();
    entry.run();
  };

  const moveHighlight = (dir: 1 | -1) => {
    const list = enabledIndexes();
    if (list.length === 0) return;
    const pos = list.indexOf(highlight);
    const next =
      pos < 0
        ? dir === 1
          ? list[0]
          : list[list.length - 1]
        : list[(pos + dir + list.length) % list.length];
    highlight = next;
    renderHighlight();
  };

  // --- キーボード ---
  const onKeyDown = (e: KeyboardEvent) => {
    // メニューが開いている間は、すべてのキーをメニュー操作として消費する。
    if (openIndex >= 0) {
      // Ctrl/⌘ アクセラレータ（Ctrl+N 等）は shortcuts 側で処理されるため、
      // ここでは二重発火を避けてメニューを閉じるだけにする（消費しない）。
      if (e.ctrlKey || e.metaKey) {
        closeMenu(false);
        return;
      }
      // 開いている最中の Alt+文字 はトップメニューの切替とみなす。
      if (e.altKey) {
        if (/^[a-z]$/i.test(e.key)) {
          const idx = menus.findIndex(
            (m) => m.mnemonic.toLowerCase() === e.key.toLowerCase(),
          );
          e.preventDefault();
          e.stopPropagation();
          if (idx >= 0) void openMenu(idx);
        }
        return;
      }
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        closeMenu();
        return;
      }
      if (e.key === "ArrowDown") {
        e.preventDefault();
        e.stopPropagation();
        moveHighlight(1);
        return;
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        e.stopPropagation();
        moveHighlight(-1);
        return;
      }
      if (e.key === "ArrowRight") {
        e.preventDefault();
        e.stopPropagation();
        void openMenu((openIndex + 1) % menus.length);
        return;
      }
      if (e.key === "ArrowLeft") {
        e.preventDefault();
        e.stopPropagation();
        void openMenu((openIndex - 1 + menus.length) % menus.length);
        return;
      }
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        e.stopPropagation();
        if (highlight >= 0) activate(currentEntries[highlight]);
        return;
      }
      // 文字キー: 開いているメニュー内のニーモニックを直接実行。
      if (/^[a-z0-9]$/i.test(e.key)) {
        const key = e.key.toLowerCase();
        const hit = currentEntries.find(
          (en) =>
            en.type === "item" &&
            (!en.enabled || en.enabled()) &&
            en.mnemonic?.toLowerCase() === key,
        );
        e.preventDefault();
        e.stopPropagation();
        if (hit) activate(hit);
        return;
      }
      if (e.key === "Tab") {
        e.preventDefault();
        e.stopPropagation();
        closeMenu();
        return;
      }
      return;
    }

    // メニューが閉じている: Alt+文字 でトップメニューを開く。
    if (e.altKey && !e.ctrlKey && !e.metaKey && /^[a-z]$/i.test(e.key)) {
      const key = e.key.toLowerCase();
      const idx = menus.findIndex((m) => m.mnemonic.toLowerCase() === key);
      if (idx >= 0) {
        e.preventDefault();
        e.stopPropagation();
        void openMenu(idx);
      }
    }
  };

  const onDocMouseDown = (e: MouseEvent) => {
    if (openIndex < 0) return;
    const target = e.target as Node | null;
    if (target && (parent.contains(target) || dropdown?.contains(target))) {
      return; // バー/ドロップダウン内のクリックは各ハンドラに任せる。
    }
    closeMenu(false);
  };

  document.addEventListener("keydown", onKeyDown, true);
  document.addEventListener("mousedown", onDocMouseDown, true);

  return {
    destroy() {
      document.removeEventListener("keydown", onKeyDown, true);
      document.removeEventListener("mousedown", onDocMouseDown, true);
      closeMenu(false);
      parent.innerHTML = "";
    },
    isOpen() {
      return openIndex >= 0;
    },
  };
}
