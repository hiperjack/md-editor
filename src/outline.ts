/**
 * 左サイドの見出しアウトラインパネル。
 * ProseMirror doc から見出し（heading）を抽出してリスト表示する。
 *  - クリックで該当見出しへジャンプ（エディタ上端に揃える）。
 *  - エディタのスクロールに連動し、現在位置の見出しをハイライトする。
 * 表示/非表示は settings.showOutline を真実の источник とし、購読で反応する。
 */
import { TextSelection } from "@milkdown/kit/prose/state";
import type { Node as ProseNode } from "@milkdown/kit/prose/model";
import type { EditorView } from "@milkdown/kit/prose/view";
import type { EditorHost } from "./editor";
import { store } from "./store";
import { settings } from "./settings";
import { t, onLangChange } from "./i18n";

type Heading = { level: number; text: string; pos: number };

/** doc を走査して見出しを抽出する。pos は heading ノードの開始位置。 */
function collectHeadings(doc: ProseNode): Heading[] {
  const headings: Heading[] = [];
  doc.descendants((node, pos) => {
    if (node.type.name === "heading") {
      headings.push({
        level: Number(node.attrs.level) || 1,
        text: node.textContent,
        pos,
      });
      return false; // 見出しのインライン子は走査不要
    }
    return true;
  });
  return headings;
}

/** エディタのスクロールコンテナ（.editor-pane）を取得する。 */
function scrollContainerOf(view: EditorView): HTMLElement | null {
  return view.dom.closest<HTMLElement>(".editor-pane");
}

export type OutlinePanel = {
  /** 見出しリストを再構築する。 */
  refresh: () => void;
};

export function createOutlinePanel(editor: EditorHost): OutlinePanel {
  const panel = document.getElementById("outline-panel");
  if (!panel) throw new Error("#outline-panel not found");

  const list = document.createElement("ul");
  list.className = "outline-list";
  const empty = document.createElement("div");
  empty.className = "outline-empty";
  panel.append(list, empty);

  const applyEmptyLabel = () => {
    empty.textContent = t("outline.empty");
  };
  applyEmptyLabel();
  onLangChange(applyEmptyLabel);

  /** 現在スクロール監視中のコンテナと、その解除関数。 */
  let detachScroll: (() => void) | null = null;

  /** heading 位置へジャンプし、エディタ上端に揃える。 */
  const jumpTo = (pos: number) => {
    const view = editor.getActiveView();
    if (!view) return;
    try {
      const size = view.state.doc.content.size;
      const at = Math.min(pos + 1, size);
      // カーソルを見出し先頭へ。PM標準の scrollIntoView は使わず（下端寄せになるため）
      view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, at)));
      view.focus();
      // 見出しの DOM 要素をスクロールコンテナの上端に揃える。
      const dom = view.nodeDOM(pos);
      if (dom instanceof HTMLElement) {
        dom.scrollIntoView({ block: "start" });
      }
      updateCurrent();
    } catch (e) {
      console.warn("jump to heading failed:", e);
    }
  };

  /** スクロール位置に応じて、現在地の見出しを .is-current でハイライト。 */
  const updateCurrent = () => {
    const view = editor.getActiveView();
    const items = Array.from(list.children) as HTMLElement[];
    if (!view || items.length === 0) return;
    const container = scrollContainerOf(view);
    if (!container) return;
    const containerTop = container.getBoundingClientRect().top;
    const THRESHOLD = 8; // 上端をわずかに越えた見出しを現在地とみなす

    let currentIdx = 0;
    for (let i = 0; i < items.length; i++) {
      const pos = Number(items[i].dataset.pos);
      const dom = view.nodeDOM(pos);
      if (!(dom instanceof HTMLElement)) continue;
      const top = dom.getBoundingClientRect().top - containerTop;
      if (top <= THRESHOLD) currentIdx = i;
      else break;
    }
    items.forEach((it, i) => it.classList.toggle("is-current", i === currentIdx));
  };

  /** アクティブエディタのスクロールを監視し直す（再描画/タブ切替時）。 */
  const attachScrollSpy = () => {
    detachScroll?.();
    detachScroll = null;
    const view = editor.getActiveView();
    if (!view) return;
    const container = scrollContainerOf(view);
    if (!container) return;
    let ticking = false;
    const onScroll = () => {
      if (ticking) return;
      ticking = true;
      requestAnimationFrame(() => {
        ticking = false;
        updateCurrent();
      });
    };
    container.addEventListener("scroll", onScroll, { passive: true });
    detachScroll = () => container.removeEventListener("scroll", onScroll);
    updateCurrent();
  };

  /** プレビュータブ用: HTML見出し(h1〜h6)からアウトラインを作る。 */
  const renderPreviewOutline = () => {
    const pane = document.querySelector<HTMLElement>(
      "#editor-host .editor-pane.preview-pane",
    );
    const headings = pane
      ? Array.from(pane.querySelectorAll<HTMLElement>("h1,h2,h3,h4,h5,h6"))
      : [];
    list.replaceChildren();
    for (const h of headings) {
      const level = Number(h.tagName.slice(1)) || 1;
      const li = document.createElement("li");
      li.className = `outline-item outline-level-${level}`;
      li.textContent = h.textContent || t("outline.untitled");
      li.title = li.textContent;
      li.addEventListener("mousedown", (e) => {
        e.preventDefault();
        h.scrollIntoView({ block: "start" });
      });
      list.appendChild(li);
    }
    const hasHeadings = headings.length > 0;
    list.hidden = !hasHeadings;
    empty.hidden = hasHeadings;
    // プレビューはProseMirror非依存のためスクロール監視は張らない
    detachScroll?.();
    detachScroll = null;
  };

  const render = () => {
    // プレビュータブはHTML見出しからアウトラインを作る（ProseMirror非依存）
    if (store.getActive()?.kind === "preview") {
      renderPreviewOutline();
      return;
    }
    const view = editor.getActiveView();
    const headings = view ? collectHeadings(view.state.doc) : [];

    list.replaceChildren();
    for (const h of headings) {
      const li = document.createElement("li");
      li.className = `outline-item outline-level-${h.level}`;
      li.textContent = h.text || t("outline.untitled");
      li.title = li.textContent;
      li.dataset.pos = String(h.pos);
      li.addEventListener("mousedown", (e) => {
        // フォーカス喪失を避けつつクリックでジャンプ
        e.preventDefault();
        jumpTo(h.pos);
      });
      list.appendChild(li);
    }

    const hasHeadings = headings.length > 0;
    list.hidden = !hasHeadings;
    empty.hidden = hasHeadings;
    attachScrollSpy();
  };

  // settings.showOutline に応じてパネルの表示/非表示を反映。
  // ツールバーボタンの active 状態は main.ts 側（ツールバー生成後）で同期する。
  const applyVisibility = () => {
    const visible = settings.get().showOutline;
    panel.classList.toggle("is-visible", visible);
    if (visible) {
      render();
    } else {
      // 非表示時はスクロール監視を解除してリークを防ぐ。
      detachScroll?.();
      detachScroll = null;
    }
  };
  applyVisibility();
  settings.subscribe(applyVisibility);

  // 内容変更・タブ切替で rAF デバウンスして再構築（表示中のみ）。
  let scheduled = false;
  const schedule = () => {
    if (!settings.get().showOutline || scheduled) return;
    scheduled = true;
    requestAnimationFrame(() => {
      scheduled = false;
      render();
    });
  };
  editor.onContentChange(schedule);
  store.subscribe(schedule);

  return { refresh: render };
}
