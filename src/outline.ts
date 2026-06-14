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
import {
  toggleFold,
  getHeadingFoldPositions,
  onHeadingFoldChange,
} from "./heading-fold";

type Heading = { level: number; text: string; pos: number; hasChildren: boolean };

/** doc を走査して見出しを抽出する。pos は heading ノードの開始位置。 */
function collectHeadings(doc: ProseNode): Heading[] {
  const headings: Heading[] = [];
  doc.descendants((node, pos) => {
    if (node.type.name === "heading") {
      headings.push({
        level: Number(node.attrs.level) || 1,
        text: node.textContent,
        pos,
        hasChildren: false,
      });
      return false; // 見出しのインライン子は走査不要
    }
    return true;
  });
  // 各見出しの直後に「より深いレベルの見出し」があれば子ありとみなす。
  for (let i = 0; i < headings.length; i++) {
    const next = headings[i + 1];
    if (next && next.level > headings[i].level) {
      headings[i].hasChildren = true;
    }
  }
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

/**
 * 左パネルとエディタの仕切りをドラッグして #outline-panel の幅を変える。
 * 確定値は settings.setOutlineWidth に保存し localStorage 永続化する。
 * 幅のクランプは settings 側(150〜600)に委ねる。
 */
function setupResizer(resizer: HTMLElement): void {
  const region = document.getElementById("editor-region");
  if (!region) return;

  let dragging = false;

  const onMove = (e: PointerEvent) => {
    if (!dragging) return;
    // editor-region 左端からのオフセットを新しいパネル幅にする
    const left = region.getBoundingClientRect().left;
    const width = e.clientX - left;
    // ライブ反映(保存はせず CSS 変数だけ更新して滑らかに)
    document.documentElement.style.setProperty(
      "--outline-w",
      `${Math.max(150, Math.min(600, Math.round(width)))}px`,
    );
  };

  const onUp = (e: PointerEvent) => {
    if (!dragging) return;
    dragging = false;
    resizer.classList.remove("is-dragging");
    document.body.classList.remove("is-resizing-outline");
    resizer.releasePointerCapture(e.pointerId);
    resizer.removeEventListener("pointermove", onMove);
    resizer.removeEventListener("pointerup", onUp);
    // 最終位置を確定保存(settings 側がクランプし applyToDom で再反映)
    const left = region.getBoundingClientRect().left;
    settings.setOutlineWidth(e.clientX - left);
  };

  resizer.addEventListener("pointerdown", (e) => {
    e.preventDefault();
    dragging = true;
    resizer.classList.add("is-dragging");
    document.body.classList.add("is-resizing-outline");
    resizer.setPointerCapture(e.pointerId);
    resizer.addEventListener("pointermove", onMove);
    resizer.addEventListener("pointerup", onUp);
  });
}

export function createOutlinePanel(editor: EditorHost): OutlinePanel {
  const panel = document.getElementById("outline-panel");
  if (!panel) throw new Error("#outline-panel not found");

  const resizer = document.getElementById("outline-resizer");
  if (resizer) setupResizer(resizer);

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

  // プレビュータブ用の表示のみ折りたたみ状態(見出しインデックスの集合)。
  // ProseMirror が無く連動先が無いため、アウトライン内の表示だけを制御する。
  const previewCollapsed = new Set<number>();

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
    const levels = headings.map((h) => Number(h.tagName.slice(1)) || 1);
    // 子有無(直後により深いレベルがあるか)。
    const hasChild = levels.map((lv, i) => {
      const nx = levels[i + 1];
      return nx !== undefined && nx > lv;
    });

    list.replaceChildren();
    let hideUntilLevel: number | null = null;
    for (let i = 0; i < headings.length; i++) {
      const h = headings[i];
      const level = levels[i];
      if (hideUntilLevel !== null && level <= hideUntilLevel) {
        hideUntilLevel = null;
      }
      const hidden = hideUntilLevel !== null;
      const isCollapsed = previewCollapsed.has(i);
      if (isCollapsed && hideUntilLevel === null) hideUntilLevel = level;
      if (hidden) continue;

      const li = document.createElement("li");
      li.className = `outline-item outline-level-${level}`;
      if (hasChild[i]) {
        const toggle = document.createElement("span");
        toggle.className =
          "outline-toggle" + (isCollapsed ? " is-collapsed" : "");
        toggle.addEventListener("mousedown", (e) => {
          e.preventDefault();
          e.stopPropagation();
          if (previewCollapsed.has(i)) previewCollapsed.delete(i);
          else previewCollapsed.add(i);
          renderPreviewOutline();
        });
        li.appendChild(toggle);
      } else {
        const spacer = document.createElement("span");
        spacer.className = "outline-toggle-spacer";
        li.appendChild(spacer);
      }
      const label = document.createElement("span");
      label.className = "outline-label";
      label.textContent = h.textContent || t("outline.untitled");
      label.title = label.textContent;
      label.addEventListener("mousedown", (e) => {
        e.preventDefault();
        h.scrollIntoView({ block: "start" });
      });
      li.appendChild(label);
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
    const collapsed = view
      ? new Set(getHeadingFoldPositions(view.state))
      : new Set<number>();

    list.replaceChildren();

    // 折りたたまれた祖先配下の項目を隠すための追跡。
    // hideUntilLevel に値がある間は「それより深いレベルの見出し」を非表示にする。
    let hideUntilLevel: number | null = null;

    for (const h of headings) {
      // 折りたたみ範囲を抜けたか判定(同レベル以上の見出しが来たら解除)。
      if (hideUntilLevel !== null && h.level <= hideUntilLevel) {
        hideUntilLevel = null;
      }
      const hidden = hideUntilLevel !== null;
      // この見出し自身が折りたたまれているなら、配下を隠し始める。
      const isCollapsed = collapsed.has(h.pos);
      if (isCollapsed && hideUntilLevel === null) {
        hideUntilLevel = h.level;
      }
      if (hidden) continue; // 折りたたまれた祖先の配下は描画しない

      const li = document.createElement("li");
      li.className = `outline-item outline-level-${h.level}`;
      li.dataset.pos = String(h.pos);

      // 子を持つ見出しにだけトグル(▸/▾)を出す。
      if (h.hasChildren) {
        const toggle = document.createElement("span");
        toggle.className =
          "outline-toggle" + (isCollapsed ? " is-collapsed" : "");
        toggle.addEventListener("mousedown", (e) => {
          e.preventDefault();
          e.stopPropagation();
          const v = editor.getActiveView();
          if (v) toggleFold(v, h.pos);
        });
        li.appendChild(toggle);
      } else {
        // トグルの幅分のスペーサで字下げ位置を揃える。
        const spacer = document.createElement("span");
        spacer.className = "outline-toggle-spacer";
        li.appendChild(spacer);
      }

      const label = document.createElement("span");
      label.className = "outline-label";
      label.textContent = h.text || t("outline.untitled");
      label.title = label.textContent;
      label.addEventListener("mousedown", (e) => {
        e.preventDefault();
        jumpTo(h.pos);
      });
      li.appendChild(label);

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
    document
      .getElementById("outline-resizer")
      ?.classList.toggle("is-visible", visible);
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
  // 折りたたみ(エディタ側トグル含む)が変わったらアウトラインを再描画する。
  onHeadingFoldChange(schedule);

  return { refresh: render };
}
