import { EditorView } from "@codemirror/view";
import { showContextMenu, type MenuItem } from "./context-menu";
import { t } from "./i18n";

/**
 * Mermaid図のビューアポップアップ。
 *
 * エディタ内のMermaidプレビュー（コードブロック直下のパネル）をクリックすると
 * 全画面オーバーレイで図を表示し、以下の操作で中身を閲覧できる:
 * - ホイール / +・− ボタン: ズーム（ホイールはカーソル位置中心）
 * - 手のひらモード（既定）: ドラッグでパン。テキストは選択されない
 * - テキスト選択モード: Iビームカーソルでドラッグ選択できる（ツールバーで切替）
 * - 右クリック: コピー / すべて選択 / コードへジャンプ のコンテキストメニュー
 * - Fitボタン: 全体表示に戻す / × ボタン・Esc: 閉じる
 *
 * プレビューパネルはDOMPurifyでシリアライズされるためイベントリスナが
 * 維持できない。そこでdocumentレベルのクリック委譲で起動する。
 */

const SCALE_MIN = 0.1;
const SCALE_MAX = 8;
const STAGE_PADDING = 20;

type ViewerMode = "pan" | "select";

function clamp(n: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, n));
}

function iconSvg(d: string): string {
  return `<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="${d}"/></svg>`;
}

// Lucide由来のアイコンパス
const HAND_ICON =
  "M18 11V6a2 2 0 0 0-4 0v5M14 10V4a2 2 0 0 0-4 0v6M10 10.5V6a2 2 0 0 0-4 0v8M18 8a2 2 0 1 1 4 0v6a8 8 0 0 1-8 8h-2c-2.8 0-4.5-.86-5.99-2.34l-3.6-3.6a2 2 0 0 1 2.83-2.82L7 15";
const TEXT_CURSOR_ICON =
  "M17 22h-1a4 4 0 0 1-4-4V6a4 4 0 0 1 4-4h1M7 22h1a4 4 0 0 0 4-4v-2M7 2h1a4 4 0 0 1 4 4v2";

/** 画面座標からキャレット位置のRangeを得る（Chromium系API）。 */
function caretRangeAt(x: number, y: number): Range | null {
  if (typeof document.caretRangeFromPoint === "function") {
    return document.caretRangeFromPoint(x, y);
  }
  // Firefox系フォールバック（WebView2では通常通らない）
  const doc = document as Document & {
    caretPositionFromPoint?: (
      x: number,
      y: number,
    ) => { offsetNode: Node; offset: number } | null;
  };
  const pos = doc.caretPositionFromPoint?.(x, y);
  if (!pos) return null;
  const r = document.createRange();
  r.setStart(pos.offsetNode, pos.offset);
  return r;
}

/**
 * 現在の選択テキストを取り出す。
 * SVG内のテキストは Selection.toString() が空になることがあるため、
 * Range の内容からのフォールバック抽出を併用する。
 */
function getSelectionText(): string {
  const sel = window.getSelection();
  if (!sel || sel.rangeCount === 0 || sel.isCollapsed) return "";
  const direct = sel.toString();
  if (direct) return direct;
  let out = "";
  for (let i = 0; i < sel.rangeCount; i++) {
    out += sel.getRangeAt(i).cloneContents().textContent ?? "";
  }
  return out;
}

/**
 * SVG文字列を受け取り、ビューアオーバーレイを開く。
 * @param sourceRoot 図の元コードブロック要素（.cm-content を含む祖先）。
 *                   「コードへジャンプ」の参照先。null可。
 */
export function openDiagramViewer(
  svgHtml: string,
  sourceRoot: HTMLElement | null = null,
): void {
  const root = document.getElementById("modal-root") ?? document.body;
  if (root.querySelector(".diagram-viewer-overlay")) return; // 多重起動防止

  const overlay = document.createElement("div");
  overlay.className = "diagram-viewer-overlay";

  // ── ツールバー ─────────────────────────────────
  const toolbar = document.createElement("div");
  toolbar.className = "diagram-viewer-toolbar";

  const makeBtn = (
    content: string,
    title: string,
    isHtml = false,
  ): HTMLButtonElement => {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "diagram-viewer-btn";
    if (isHtml) b.innerHTML = content;
    else b.textContent = content;
    b.title = title;
    return b;
  };

  const panBtn = makeBtn(iconSvg(HAND_ICON), t("viewer.modePan"), true);
  const selectBtn = makeBtn(
    iconSvg(TEXT_CURSOR_ICON),
    t("viewer.modeSelect"),
    true,
  );
  const sep1 = document.createElement("span");
  sep1.className = "diagram-viewer-sep";
  const zoomOutBtn = makeBtn("−", t("viewer.zoomOut"));
  const zoomLabel = document.createElement("span");
  zoomLabel.className = "diagram-viewer-zoom-label";
  const zoomInBtn = makeBtn("＋", t("viewer.zoomIn"));
  const fitBtn = makeBtn("Fit", t("viewer.fit"));
  const sep2 = document.createElement("span");
  sep2.className = "diagram-viewer-sep";
  const closeBtn = makeBtn("×", t("viewer.close"));
  closeBtn.classList.add("diagram-viewer-close");

  toolbar.appendChild(panBtn);
  toolbar.appendChild(selectBtn);
  toolbar.appendChild(sep1);
  toolbar.appendChild(zoomOutBtn);
  toolbar.appendChild(zoomLabel);
  toolbar.appendChild(zoomInBtn);
  toolbar.appendChild(fitBtn);
  toolbar.appendChild(sep2);
  toolbar.appendChild(closeBtn);

  // ── ビューポート（パン・ズームの操作面） ───────────
  const viewport = document.createElement("div");
  viewport.className = "diagram-viewer-viewport";

  const stage = document.createElement("div");
  stage.className = "diagram-viewer-stage";
  stage.innerHTML = svgHtml;
  viewport.appendChild(stage);

  overlay.appendChild(viewport);
  overlay.appendChild(toolbar);
  root.appendChild(overlay);

  // mermaidのSVGは max-width / width:100% を持つため、固有サイズに固定して
  // transform: scale の基準を安定させる
  const svg = stage.querySelector("svg");
  let baseW = 600;
  let baseH = 400;
  if (svg) {
    const vb = svg.viewBox?.baseVal;
    if (vb && vb.width > 0 && vb.height > 0) {
      baseW = vb.width;
      baseH = vb.height;
    } else {
      const r = svg.getBoundingClientRect();
      if (r.width > 0) {
        baseW = r.width;
        baseH = r.height;
      }
    }
    svg.style.maxWidth = "none";
    svg.style.width = `${baseW}px`;
    svg.style.height = `${baseH}px`;
    svg.style.display = "block";
  }
  const stageW = baseW + STAGE_PADDING * 2;
  const stageH = baseH + STAGE_PADDING * 2;

  // ── モード（手のひら / テキスト選択） ─────────────
  let mode: ViewerMode = "pan";
  const setMode = (m: ViewerMode) => {
    mode = m;
    viewport.classList.toggle("select-mode", m === "select");
    panBtn.classList.toggle("is-active", m === "pan");
    selectBtn.classList.toggle("is-active", m === "select");
  };
  panBtn.addEventListener("click", () => setMode("pan"));
  selectBtn.addEventListener("click", () => setMode("select"));

  // ── パン・ズーム状態 ──────────────────────────
  let scale = 1;
  let tx = 0;
  let ty = 0;

  const apply = () => {
    stage.style.transform = `translate(${tx}px, ${ty}px) scale(${scale})`;
    zoomLabel.textContent = `${Math.round(scale * 100)}%`;
  };

  /** ビューポート座標 (cx, cy) を不動点としてズームする。 */
  const zoomAt = (cx: number, cy: number, factor: number) => {
    const next = clamp(scale * factor, SCALE_MIN, SCALE_MAX);
    const k = next / scale;
    if (k === 1) return;
    tx = cx - k * (cx - tx);
    ty = cy - k * (cy - ty);
    scale = next;
    apply();
  };

  const zoomAtCenter = (factor: number) => {
    zoomAt(viewport.clientWidth / 2, viewport.clientHeight / 2, factor);
  };

  /** 全体が収まるスケールで中央配置（拡大はしない）。 */
  const fit = () => {
    const vw = viewport.clientWidth - 32;
    const vh = viewport.clientHeight - 32;
    scale = clamp(Math.min(vw / stageW, vh / stageH, 1), SCALE_MIN, SCALE_MAX);
    tx = (viewport.clientWidth - stageW * scale) / 2;
    ty = (viewport.clientHeight - stageH * scale) / 2;
    apply();
  };

  // ── 操作イベント ─────────────────────────────
  const onWheel = (e: WheelEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const rect = viewport.getBoundingClientRect();
    zoomAt(
      e.clientX - rect.left,
      e.clientY - rect.top,
      e.deltaY < 0 ? 1.15 : 1 / 1.15,
    );
  };
  viewport.addEventListener("wheel", onWheel, { passive: false });

  let dragging = false;
  let selecting = false;
  let lastX = 0;
  let lastY = 0;
  viewport.addEventListener("pointerdown", (e) => {
    if (e.button !== 0) return;
    if (mode === "select") {
      // ChromiumはSVGテキストのネイティブドラッグ選択が機能しないため、
      // caretRangeFromPoint で選択範囲を自前で構築する。
      const sel = window.getSelection();
      if (!sel) return;
      const r = caretRangeAt(e.clientX, e.clientY);
      if (r && stage.contains(r.startContainer)) {
        e.preventDefault();
        sel.removeAllRanges();
        sel.addRange(r);
        selecting = true;
        try {
          viewport.setPointerCapture(e.pointerId);
        } catch {
          // capture不可でも選択自体は継続できる
        }
      } else {
        // 図の外（背景）クリックは選択解除
        sel.removeAllRanges();
      }
      return;
    }
    e.preventDefault();
    dragging = true;
    lastX = e.clientX;
    lastY = e.clientY;
    try {
      viewport.setPointerCapture(e.pointerId);
    } catch {
      // capture不可でもパン自体は継続できる
    }
    viewport.classList.add("dragging");
  });
  viewport.addEventListener("pointermove", (e) => {
    if (selecting) {
      const r = caretRangeAt(e.clientX, e.clientY);
      if (r && stage.contains(r.startContainer)) {
        try {
          window.getSelection()?.extend(r.startContainer, r.startOffset);
        } catch {
          // ノード跨ぎでextend不可のケースは無視（選択は直前状態を維持）
        }
      }
      return;
    }
    if (!dragging) return;
    tx += e.clientX - lastX;
    ty += e.clientY - lastY;
    lastX = e.clientX;
    lastY = e.clientY;
    apply();
  });
  const endDrag = (e: PointerEvent) => {
    if (selecting) {
      selecting = false;
      try {
        viewport.releasePointerCapture(e.pointerId);
      } catch {
        // capture が外れていても無視
      }
    }
    if (!dragging) return;
    dragging = false;
    viewport.classList.remove("dragging");
    try {
      viewport.releasePointerCapture(e.pointerId);
    } catch {
      // capture が外れていても無視
    }
  };
  viewport.addEventListener("pointerup", endDrag);
  viewport.addEventListener("pointercancel", endDrag);

  const close = () => {
    document.removeEventListener("keydown", onKey, true);
    overlay.remove();
  };
  const onKey = (e: KeyboardEvent) => {
    // Ctrl/⌘+Tab で 手のひら ⇄ テキスト選択 を切り替える
    if ((e.ctrlKey || e.metaKey) && e.key === "Tab") {
      e.preventDefault();
      e.stopPropagation();
      setMode(mode === "pan" ? "select" : "pan");
      return;
    }
    if (e.key === "Escape") {
      // コンテキストメニューが開いていればそちらのEscに任せる
      if (document.querySelector(".context-menu")) return;
      e.preventDefault();
      e.stopPropagation();
      close();
    }
  };
  document.addEventListener("keydown", onKey, true);

  zoomInBtn.addEventListener("click", () => zoomAtCenter(1.25));
  zoomOutBtn.addEventListener("click", () => zoomAtCenter(1 / 1.25));
  fitBtn.addEventListener("click", fit);
  closeBtn.addEventListener("click", close);

  // ── コンテキストメニュー ────────────────────────
  const copySelection = async () => {
    const text = getSelectionText();
    if (!text) return;
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      // クリップボードAPI不可時のフォールバック
      document.execCommand("copy");
    }
  };

  const selectAllText = () => {
    setMode("select");
    const target = stage.querySelector("svg") ?? stage;
    const sel = window.getSelection();
    if (!sel) return;
    sel.removeAllRanges();
    const range = document.createRange();
    range.selectNodeContents(target);
    sel.addRange(range);
  };

  /** 選択テキストをコードブロックのソース内で検索し、選択してジャンプする。 */
  const jumpToCode = () => {
    const text = getSelectionText().trim();
    if (!text || !sourceRoot) return;
    const cmContent = sourceRoot.querySelector<HTMLElement>(".cm-content");
    if (!cmContent) return;
    const view = EditorView.findFromDOM(cmContent);
    if (!view) return;
    const doc = view.state.doc.toString();
    const idx = doc.indexOf(text);

    // 「プレビューのみ」モードでコードが隠れている場合は展開する。
    // （.cm-editor が非表示＝offsetParentがnull → トグルボタンで開く）
    const block = cmContent.closest(".milkdown-code-block");
    const cmEditor = block?.querySelector<HTMLElement>(".cm-editor");
    const toggle = block?.querySelector<HTMLElement>(".preview-toggle-button");
    if (cmEditor && cmEditor.offsetParent === null && toggle) {
      toggle.click();
    }

    close();
    // 展開直後はレイアウトが未確定なので、次フレームで選択・スクロールする。
    requestAnimationFrame(() => {
      if (idx >= 0) {
        view.dispatch({
          selection: { anchor: idx, head: idx + text.length },
          scrollIntoView: true,
        });
      }
      view.focus();
    });
  };

  overlay.addEventListener("contextmenu", (e) => {
    e.preventDefault();
    e.stopPropagation();
    const hasSelection = getSelectionText().trim().length > 0;
    const canJump = !!sourceRoot?.querySelector(".cm-content");
    const items: MenuItem[] = [
      {
        type: "item",
        label: t("viewer.copy"),
        action: () => void copySelection(),
        disabled: !hasSelection,
      },
      {
        type: "item",
        label: t("viewer.selectAll"),
        action: selectAllText,
      },
      { type: "separator" },
      {
        type: "item",
        label: t("viewer.jump"),
        action: jumpToCode,
        disabled: !hasSelection || !canJump,
      },
    ];
    showContextMenu(e.clientX, e.clientY, items);
  });

  setMode("pan");
  fit();
}

/**
 * エディタ内Mermaidプレビューのクリックでビューアを開く委譲リスナを登録する。
 * ブートストラップ時に1回呼ぶ。
 */
export function installDiagramViewerTrigger(): void {
  document.addEventListener(
    "click",
    (e) => {
      const target = e.target as Element | null;
      // エディタ内インラインのMermaidプレビュー。
      const inlinePreview = target?.closest(
        ".editor-pane .preview .mermaid-preview",
      ) as HTMLElement | null;
      // HTMLプレビュータブ内のMermaid図（出力と同じ <figure class="mermaid-figure">）。
      const docFigure = target?.closest(
        ".preview-pane .mermaid-figure",
      ) as HTMLElement | null;
      const host = inlinePreview ?? docFigure;
      if (!host) return;
      const svg = host.querySelector("svg");
      if (!svg) return;
      e.preventDefault();
      e.stopPropagation();
      // 「コードへジャンプ」はエディタ内インラインのときのみ有効。
      // プレビュータブには元コードが無いため sourceRoot は null。
      let sourceRoot: HTMLElement | null = null;
      if (inlinePreview) {
        sourceRoot = inlinePreview.parentElement;
        while (
          sourceRoot &&
          !sourceRoot.querySelector(".cm-content") &&
          !sourceRoot.classList.contains("editor-pane")
        ) {
          sourceRoot = sourceRoot.parentElement;
        }
        if (sourceRoot && !sourceRoot.querySelector(".cm-content")) {
          sourceRoot = null;
        }
      }
      openDiagramViewer(svg.outerHTML, sourceRoot);
    },
    { capture: true },
  );
}
