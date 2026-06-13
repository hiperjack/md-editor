import { store, type Tab } from "./store";
import { showContextMenu, type MenuItem } from "./context-menu";
import { t } from "./i18n";

export type TabBarHandlers = {
  onSelect: (tabId: string) => void;
  onClose: (tabId: string) => void;
  onNew: () => void;
  onCloseOthers: (tabId: string) => void;
  onCloseToRight: (tabId: string) => void;
  onOpenInNewWindow: (tabId: string) => void;
  onCopyPath: (tabId: string) => void;
  /** タブの内容をHTMLプレビュータブで開く。 */
  onHtmlPreview: (tabId: string) => void;
  /** タブをウィンドウ外で離して切り離した（新規ウィンドウ化）。pos は離した画面座標。 */
  onTearOff: (tabId: string, pos: { x: number; y: number }) => void;
  /** ドラッグ中の移動（結合先ハイライト用）。画面座標を渡す。 */
  onDragMove?: (screenX: number, screenY: number) => void;
  /** ドラッグ終了（結合先ハイライトのクリア用）。 */
  onDragEnd?: () => void;
};

/** タブバーの外部制御 API。別ウィンドウからの結合ドラッグ時の青線表示に使う。 */
export type TabBar = {
  /** 結合先として、ビューポート X 位置に挿入インジケータを表示する。 */
  showExternalDropIndicator: (clientX: number) => void;
  /** 挿入インジケータを消す。 */
  hideExternalDropIndicator: () => void;
};

/** ドラッグ開始とみなす移動量（px）。これ未満はクリック（選択）扱い。 */
const DRAG_THRESHOLD = 4;

function fileNameOf(tab: Tab): string {
  if (tab.kind === "preview") return tab.previewTitle ?? "Preview";
  if (!tab.filePath) return "Untitled";
  const m = tab.filePath.split(/[\\/]/);
  return m[m.length - 1] || tab.filePath;
}

export function createTabBar(
  parent: HTMLElement,
  handlers: TabBarHandlers,
): TabBar {
  parent.innerHTML = "";
  parent.style.position = "relative";

  const list = document.createElement("div");
  list.className = "tab-list";
  parent.appendChild(list);

  const newBtn = document.createElement("button");
  newBtn.className = "tab-new-btn";
  newBtn.title = "新規タブ (Ctrl+N)";
  newBtn.textContent = "+";
  newBtn.addEventListener("click", () => handlers.onNew());
  parent.appendChild(newBtn);

  // 並べ替え時の挿入位置を示す縦線。tabbar 基準で絶対配置。
  const indicator = document.createElement("div");
  indicator.className = "tab-drop-indicator";
  indicator.hidden = true;
  parent.appendChild(indicator);

  // ドラッグ状態（描画をまたいで保持。ドラッグ中は再描画しないため要素は維持される）。
  let drag: {
    id: string;
    fromIndex: number;
    startX: number;
    startY: number;
    pointerId: number;
    el: HTMLElement;
    started: boolean;
  } | null = null;
  // ドラッグ直後の click を選択として処理しないためのフラグ。
  let suppressClickId: string | null = null;

  const isOutsideWindow = (e: PointerEvent): boolean =>
    e.clientX < 0 ||
    e.clientY < 0 ||
    e.clientX > window.innerWidth ||
    e.clientY > window.innerHeight;

  /** ポインタ X から挿入位置（0..n）と、インジケータの parent 基準 X を求める。 */
  const computeInsertion = (clientX: number): { ins: number; x: number } => {
    const els = Array.from(list.querySelectorAll<HTMLElement>(".tab"));
    const parentRect = parent.getBoundingClientRect();
    for (let i = 0; i < els.length; i++) {
      const r = els[i].getBoundingClientRect();
      if (clientX < r.left + r.width / 2) {
        return { ins: i, x: r.left - parentRect.left };
      }
    }
    const last = els[els.length - 1];
    const x = last
      ? last.getBoundingClientRect().right - parentRect.left
      : 0;
    return { ins: els.length, x };
  };

  const endDrag = (el: HTMLElement, pointerId: number) => {
    try {
      el.releasePointerCapture(pointerId);
    } catch {
      /* キャプチャ済みでない場合は無視 */
    }
    el.classList.remove("dragging");
    indicator.hidden = true;
  };

  const render = () => {
    const { tabs, activeTabId } = store.getState();
    list.innerHTML = "";

    tabs.forEach((tab, index) => {
      const el = document.createElement("div");
      el.className = "tab";
      el.dataset.tabId = tab.id;
      if (tab.id === activeTabId) el.classList.add("active");
      const dirty = store.isDirty(tab.id);
      if (dirty) el.classList.add("dirty");

      const dot = document.createElement("span");
      dot.className = "tab-dirty-dot";
      dot.textContent = dirty ? "●" : "";
      el.appendChild(dot);

      const label = document.createElement("span");
      label.className = "tab-label";
      label.textContent = fileNameOf(tab);
      label.title =
        tab.kind === "preview"
          ? (tab.previewTitle ?? "")
          : (tab.filePath ?? "Untitled");
      el.appendChild(label);

      const closeBtn = document.createElement("button");
      closeBtn.className = "tab-close";
      closeBtn.textContent = "×";
      closeBtn.title = "閉じる";
      closeBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        handlers.onClose(tab.id);
      });
      el.appendChild(closeBtn);

      // ---- ドラッグ（並べ替え / 切り離し） ----
      el.addEventListener("pointerdown", (e) => {
        if (e.button !== 0) return;
        if ((e.target as HTMLElement).closest(".tab-close")) return;
        drag = {
          id: tab.id,
          fromIndex: index,
          startX: e.clientX,
          startY: e.clientY,
          pointerId: e.pointerId,
          el,
          started: false,
        };
        try {
          el.setPointerCapture(e.pointerId);
        } catch {
          /* 無視 */
        }
      });

      el.addEventListener("pointermove", (e) => {
        if (!drag || drag.id !== tab.id) return;
        if (!drag.started) {
          if (
            Math.abs(e.clientX - drag.startX) < DRAG_THRESHOLD &&
            Math.abs(e.clientY - drag.startY) < DRAG_THRESHOLD
          ) {
            return;
          }
          drag.started = true;
          el.classList.add("dragging");
        }
        if (isOutsideWindow(e)) {
          indicator.hidden = true;
        } else {
          const { x } = computeInsertion(e.clientX);
          indicator.style.left = `${x}px`;
          indicator.hidden = false;
        }
        // 結合先ウィンドウのハイライト用に画面座標を通知。
        handlers.onDragMove?.(e.screenX, e.screenY);
      });

      el.addEventListener("pointerup", (e) => {
        if (!drag || drag.id !== tab.id) return;
        const d = drag;
        drag = null;
        endDrag(el, e.pointerId);
        handlers.onDragEnd?.();
        if (!d.started) return; // しきい値未満 → click（選択）に委ねる

        suppressClickId = tab.id;
        if (isOutsideWindow(e)) {
          // 結合/新規ウィンドウ化/何もしない の判定は onTearOff 側で行う。
          handlers.onTearOff(tab.id, { x: e.screenX, y: e.screenY });
        } else {
          const { ins } = computeInsertion(e.clientX);
          const to = ins > d.fromIndex ? ins - 1 : ins;
          if (to !== d.fromIndex && to >= 0) store.reorder(d.fromIndex, to);
        }
      });

      el.addEventListener("pointercancel", (e) => {
        if (!drag || drag.id !== tab.id) return;
        drag = null;
        endDrag(el, e.pointerId);
        handlers.onDragEnd?.();
      });

      el.addEventListener("click", () => {
        if (suppressClickId === tab.id) {
          suppressClickId = null;
          return;
        }
        handlers.onSelect(tab.id);
      });

      el.addEventListener("auxclick", (e) => {
        if (e.button === 1) {
          e.preventDefault();
          handlers.onClose(tab.id);
        }
      });

      el.addEventListener("mousedown", (e) => {
        if (e.button === 1) e.preventDefault();
      });

      el.addEventListener("contextmenu", (e) => {
        e.preventDefault();
        e.stopPropagation();
        const items: MenuItem[] = [
          {
            type: "item",
            label: t("tabcm.close"),
            action: () => handlers.onClose(tab.id),
          },
          {
            type: "item",
            label: t("tabcm.closeOthers"),
            disabled: store.getState().tabs.length <= 1,
            action: () => handlers.onCloseOthers(tab.id),
          },
          {
            type: "item",
            label: t("tabcm.closeRight"),
            disabled:
              store.getState().tabs.findIndex((x) => x.id === tab.id) >=
              store.getState().tabs.length - 1,
            action: () => handlers.onCloseToRight(tab.id),
          },
          { type: "separator" },
          {
            type: "item",
            label: t("tabcm.htmlPreview"),
            // プレビュータブ自身は対象外
            disabled: tab.kind === "preview",
            action: () => handlers.onHtmlPreview(tab.id),
          },
          { type: "separator" },
          {
            type: "item",
            label: t("tabcm.newWindow"),
            action: () => handlers.onOpenInNewWindow(tab.id),
          },
          {
            type: "item",
            label: t("tabcm.copyPath"),
            disabled: !tab.filePath,
            action: () => handlers.onCopyPath(tab.id),
          },
        ];
        showContextMenu(e.clientX, e.clientY, items);
      });

      list.appendChild(el);
    });
  };

  store.subscribe(render);
  render();

  return {
    showExternalDropIndicator: (clientX: number) => {
      const { x } = computeInsertion(clientX);
      indicator.style.left = `${x}px`;
      indicator.hidden = false;
    },
    hideExternalDropIndicator: () => {
      indicator.hidden = true;
    },
  };
}
