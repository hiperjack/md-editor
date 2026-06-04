/**
 * ソースmarkdown相当の行番号ガター。
 *
 * - 行番号の単位はソース行 (markdown 文字列の \n で分割したインデックス)。
 *   ソースN行 = ガター N行 と厳密に一致するよう、source markdown を直接参照して
 *   blank 行と content 行を 1 対 1 でマップする。
 * - 視覚的折り返しでは行番号は増えない。
 * - ガター本体はスクロールコンテナ外（pane直下、固定位置）に配置し、
 *   内部ラッパに transform: translateY(-scrollTop) を当ててスクロールと同期する。
 *   これで WebView2 の絶対配置子要素のペイント不整合（残像）を回避する。
 */

const GUTTER_WIDTH = 44;

const HEADING_OR_P = new Set(["h1", "h2", "h3", "h4", "h5", "h6", "p"]);
const BLOCK_LIKE = new Set([
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "p",
  "ul",
  "ol",
  "table",
  "pre",
  "blockquote",
  "hr",
]);

export function attachLineNumbers(
  pane: HTMLElement,
  getSource: () => string,
): () => void {
  const gutter = document.createElement("div");
  gutter.className = "line-gutter";
  const inner = document.createElement("div");
  inner.className = "line-gutter-inner";
  gutter.appendChild(inner);
  pane.insertBefore(gutter, pane.firstChild);

  let raf = 0;
  const schedule = () => {
    if (raf) return;
    raf = requestAnimationFrame(() => {
      raf = 0;
      update();
    });
  };

  const findPM = () => pane.querySelector<HTMLElement>(".ProseMirror");

  const update = () => {
    const pm = findPM();
    if (!pm) return;
    const paneRect = pane.getBoundingClientRect();
    const offset = pane.scrollTop - paneRect.top;
    const source = (() => {
      try {
        return getSource();
      } catch {
        return "";
      }
    })();
    const entries = collectEntries(pm, offset, source);
    render(inner, entries);
  };

  const onScroll = () => {
    // translate3d で GPU 合成レイヤを維持（残像対策）
    inner.style.transform = `translate3d(0, ${-pane.scrollTop}px, 0)`;
  };

  const ro = new ResizeObserver(schedule);
  const mo = new MutationObserver(schedule);
  const onResize = () => schedule();

  let started = false;
  const tryStart = () => {
    if (started) return;
    const pm = findPM();
    if (!pm) {
      requestAnimationFrame(tryStart);
      return;
    }
    started = true;
    ro.observe(pm);
    mo.observe(pm, { childList: true, subtree: true, characterData: true });
    pane.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onResize);
    schedule();
    onScroll();
  };
  tryStart();

  return () => {
    ro.disconnect();
    mo.disconnect();
    pane.removeEventListener("scroll", onScroll);
    window.removeEventListener("resize", onResize);
    if (raf) cancelAnimationFrame(raf);
    gutter.remove();
  };
}

type Entry = { top: number; line: number | string; height: number };
type Ctx = { line: number };
type SrcCtx = {
  srcIdx: number;
  domIdx: number;
  srcLines: string[];
  blocks: HTMLElement[];
};

function collectEntries(
  pm: HTMLElement,
  offset: number,
  source: string,
): Entry[] {
  const out: Entry[] = [];
  const blocks = flattenTopLevel(pm);

  if (!source) {
    // フォールバック: source が無いときは DOM だけで連番付け (旧挙動)
    const ctx: Ctx = { line: 1 };
    for (let i = 0; i < blocks.length; i++) {
      walkBlock(blocks[i], ctx, out, offset);
      if (i < blocks.length - 1) {
        pushGapEntry(out, blocks[i], blocks[i + 1], ctx.line, offset);
        ctx.line += 1;
      }
    }
    return out;
  }

  // Source-aware: 1 source line = 1 gutter entry。
  // ソース markdown の各 \n を 1 行と数え、blank行は gap entry、content行は
  // 対応する DOM ブロック (もしくは hardbreak/li/cm-line/tr) と紐付ける。
  const srcLinesRaw = source.split("\n");
  // 末尾の空行 (trailing \n) は除外。
  const srcLines =
    srcLinesRaw.length > 0 && srcLinesRaw[srcLinesRaw.length - 1] === ""
      ? srcLinesRaw.slice(0, -1)
      : srcLinesRaw;

  const ctx: SrcCtx = { srcIdx: 0, domIdx: 0, srcLines, blocks };

  while (ctx.srcIdx < ctx.srcLines.length) {
    const line = ctx.srcLines[ctx.srcIdx];

    if (line.trim() === "") {
      // 空行は remarkBlankLines が実体化した空段落 DOM ブロックに 1:1 で紐付ける。
      // 連続空行も各々が空段落を持つため、正しい位置・本数で番号が並ぶ。
      const block = ctx.blocks[ctx.domIdx];
      if (block && isBlankParagraphBlock(block)) {
        pushAt(out, block, ctx.srcIdx + 1, offset);
        ctx.domIdx++;
      } else {
        // 対応する空段落が無い場合は従来の gap 推定にフォールバック。
        pushBlankLineEntry(out, ctx, offset);
      }
      ctx.srcIdx++;
      continue;
    }

    // content行: 現在の DOM ブロックを処理し、消費した分 srcIdx を進める
    if (ctx.domIdx >= ctx.blocks.length) {
      // DOM が source より少ない場合は残りの content 行は無視 (位置を持たない)
      ctx.srcIdx++;
      continue;
    }

    walkBlockSrc(ctx.blocks[ctx.domIdx], ctx, out, offset);
    ctx.domIdx++;
  }

  return out;
}

function pushBlankLineEntry(
  out: Entry[],
  ctx: SrcCtx,
  offset: number,
): void {
  const prev = ctx.blocks[ctx.domIdx - 1] ?? null;
  const next = ctx.blocks[ctx.domIdx] ?? null;
  let top: number;
  let height: number;
  if (prev && next) {
    const prevRect = prev.getBoundingClientRect();
    const nextRect = next.getBoundingClientRect();
    const gap = nextRect.top - prevRect.bottom;
    if (gap <= 0) return;
    top = Math.round(prevRect.bottom + offset);
    height = Math.max(1, Math.round(gap));
  } else if (prev) {
    const r = prev.getBoundingClientRect();
    top = Math.round(r.bottom + offset);
    height = 16;
  } else if (next) {
    const r = next.getBoundingClientRect();
    if (r.height === 0) return;
    top = Math.round(r.top + offset);
    height = 16;
  } else {
    return;
  }
  out.push({ top, line: ctx.srcIdx + 1, height });
}

function walkBlockSrc(
  el: HTMLElement,
  ctx: SrcCtx,
  out: Entry[],
  offset: number,
): void {
  if (isCodeBlock(el)) {
    pushAt(out, el, ctx.srcIdx + 1, offset);
    ctx.srcIdx++;
    const cmLines = Array.from(el.querySelectorAll<HTMLElement>(".cm-line"));
    // CodeMirror はカーソル位置確保用の空 cm-line を末尾に挿入することがある。
    // 実ソースには対応する行がないので末尾の空行は除外する。
    while (
      cmLines.length > 0 &&
      (cmLines[cmLines.length - 1].textContent || "").length === 0
    ) {
      cmLines.pop();
    }
    cmLines.forEach((cl) => {
      pushAt(out, cl, ctx.srcIdx + 1, offset);
      ctx.srcIdx++;
    });
    pushPhantomEntry(out, el, ctx.srcIdx + 1, offset, "bottom");
    ctx.srcIdx++;
    return;
  }

  const tag = el.tagName.toLowerCase();

  if (tag === "ul" || tag === "ol") {
    findListItems(el).forEach((li) => walkLiSrc(li, ctx, out, offset));
    return;
  }

  if (tag === "table") {
    const trs = findTableRows(el);
    if (trs.length === 0) {
      pushAt(out, el, ctx.srcIdx + 1, offset);
      ctx.srcIdx++;
      return;
    }
    // ソース markdown のテーブルは「ヘッダ行 + 区切り行 + body 行」だが
    // DOM のヘッダ tr は 1 つで両方を兼ねる。番号は「N-N+1」の併記で表す。
    pushAt(
      out,
      trs[0],
      `${ctx.srcIdx + 1}-${ctx.srcIdx + 2}`,
      offset,
    );
    ctx.srcIdx += 2;
    for (let i = 1; i < trs.length; i++) {
      pushAt(out, trs[i], ctx.srcIdx + 1, offset);
      ctx.srcIdx++;
    }
    return;
  }

  if (tag === "blockquote") {
    Array.from(el.children).forEach((child) => {
      walkBlockSrc(child as HTMLElement, ctx, out, offset);
    });
    return;
  }

  // 段落・見出し・hr
  pushAt(out, el, ctx.srcIdx + 1, offset);
  ctx.srcIdx++;
  const brs = el.querySelectorAll<HTMLBRElement>('br[data-type="hardbreak"]');
  brs.forEach((br) => {
    pushAfterBreak(out, br, ctx.srcIdx + 1, offset);
    ctx.srcIdx++;
  });
}

function walkLiSrc(
  li: HTMLElement,
  ctx: SrcCtx,
  out: Entry[],
  offset: number,
): void {
  pushAt(out, li, ctx.srcIdx + 1, offset);
  ctx.srcIdx++;
  findNestedLists(li).forEach((nested) =>
    walkBlockSrc(nested, ctx, out, offset),
  );
}

function pushGapEntry(
  out: Entry[],
  prev: HTMLElement,
  next: HTMLElement,
  line: number,
  offset: number,
): void {
  const prevRect = prev.getBoundingClientRect();
  const nextRect = next.getBoundingClientRect();
  const gap = nextRect.top - prevRect.bottom;
  if (gap <= 0) return;
  out.push({
    top: Math.round(prevRect.bottom + offset),
    line,
    height: Math.max(1, Math.round(gap)),
  });
}

/**
 * DOMに対応行が存在しない論理行（コードブロック閉じフェンス、テーブル区切り等）の
 * 番号を、対象要素の上端/下端に小さな高さで置く。
 */
function pushPhantomEntry(
  out: Entry[],
  el: HTMLElement,
  line: number | string,
  offset: number,
  edge: "top" | "bottom",
): void {
  const rect = el.getBoundingClientRect();
  if (rect.height === 0) return;
  // PHANTOM_H は本文 1 行の高さ相当。code 閉じフェンスや table 区切りが
  // 隣の content 行 (~22-24px) と並んで違和感ないようにする。
  const PHANTOM_H = 22;
  const top =
    edge === "top"
      ? Math.round(rect.top + offset)
      : Math.round(rect.bottom - PHANTOM_H + offset);
  out.push({ top, line, height: PHANTOM_H });
}

function flattenTopLevel(pm: HTMLElement): HTMLElement[] {
  const out: HTMLElement[] = [];

  const visit = (el: HTMLElement) => {
    const rect = el.getBoundingClientRect();
    if (rect.height === 0) return;

    if (isCodeBlock(el)) {
      out.push(el);
      return;
    }

    const tag = el.tagName.toLowerCase();

    if (BLOCK_LIKE.has(tag)) {
      // 空段落は「空行」を表すノードなので 1 ブロックとして数える
      // (remarkBlankLines が実体化したもの)。空見出しのみ従来通り除外する。
      if (
        tag !== "p" &&
        HEADING_OR_P.has(tag) &&
        isEmptyTextBlock(el)
      ) {
        return;
      }
      out.push(el);
      return;
    }

    if (tag === "div" || tag === "section" || tag === "article") {
      Array.from(el.children).forEach((c) => visit(c as HTMLElement));
      return;
    }
  };

  Array.from(pm.children).forEach((c) => visit(c as HTMLElement));
  return out;
}

function isEmptyTextBlock(el: HTMLElement): boolean {
  const text = (el.textContent ?? "").replace(/​/g, "").trim();
  if (text !== "") return false;
  if (el.querySelector("br, img")) return false;
  return true;
}

/**
 * 空行を表す空段落ブロックか判定する。
 * ProseMirror は空段落をカーソル保持用の <br class="ProseMirror-trailingBreak">
 * 付きで描画することがあるため、isEmptyTextBlock (br があると false) ではなく
 * 「テキストも画像も無い <p>」を空段落とみなす。
 */
function isBlankParagraphBlock(el: HTMLElement): boolean {
  if (el.tagName.toLowerCase() !== "p") return false;
  const text = (el.textContent ?? "").replace(/​/g, "").trim();
  if (text !== "") return false;
  if (el.querySelector("img")) return false;
  return true;
}

function walkBlock(
  el: HTMLElement,
  ctx: Ctx,
  out: Entry[],
  offset: number,
): void {
  if (isCodeBlock(el)) {
    pushAt(out, el, ctx.line, offset);
    ctx.line++;
    el.querySelectorAll<HTMLElement>(".cm-line").forEach((cl) => {
      pushAt(out, cl, ctx.line, offset);
      ctx.line++;
    });
    // 閉じフェンス ``` の行。DOM には存在しないのでブロック下端に小さな
    // エントリを置いて番号だけ表示する。
    pushPhantomEntry(out, el, ctx.line, offset, "bottom");
    ctx.line++;
    return;
  }

  const tag = el.tagName.toLowerCase();

  if (tag === "ul" || tag === "ol") {
    findListItems(el).forEach((li) => walkLi(li, ctx, out, offset));
    return;
  }

  if (tag === "table") {
    const trs = findTableRows(el);
    if (trs.length === 0) {
      pushAt(out, el, ctx.line, offset);
      ctx.line++;
      return;
    }
    pushAt(out, trs[0], ctx.line, offset);
    ctx.line++;
    // テーブル区切り行 |---|---|---| はDOMに存在しないが、
    // ヘッダ行の下端に小さなエントリを置いて番号を表示する。
    pushPhantomEntry(out, trs[0], ctx.line, offset, "bottom");
    ctx.line++;
    for (let i = 1; i < trs.length; i++) {
      pushAt(out, trs[i], ctx.line, offset);
      ctx.line++;
    }
    return;
  }

  if (tag === "blockquote") {
    Array.from(el.children).forEach((child) => {
      walkBlock(child as HTMLElement, ctx, out, offset);
    });
    return;
  }

  // 段落・見出しなど inline-content のブロック。
  // remark-breaks により単一 \n が <br data-type="hardbreak"> として
  // ノード化されるため、これを論理行として 1 行ずつカウントする。
  pushAt(out, el, ctx.line, offset);
  ctx.line++;
  const brs = el.querySelectorAll<HTMLBRElement>('br[data-type="hardbreak"]');
  brs.forEach((br) => {
    pushAfterBreak(out, br, ctx.line, offset);
    ctx.line++;
  });
}

function pushAfterBreak(
  out: Entry[],
  br: HTMLBRElement,
  line: number,
  offset: number,
): void {
  // <br> 直後のテキスト位置に行番号エントリを置く
  const range = document.createRange();
  range.setStartAfter(br);
  range.collapse(true);
  const rects = range.getClientRects();
  let rect: DOMRect | null = null;
  for (let i = 0; i < rects.length; i++) {
    if (rects[i].height > 0) {
      rect = rects[i];
      break;
    }
  }
  if (!rect) {
    // フォールバック: br の bounding rect の下端
    const brRect = br.getBoundingClientRect();
    if (brRect.height === 0) return;
    out.push({
      top: Math.round(brRect.bottom + offset),
      line,
      height: Math.max(1, Math.round(brRect.height || 22)),
    });
    return;
  }
  out.push({
    top: Math.round(rect.top + offset),
    line,
    height: Math.max(1, Math.round(rect.height)),
  });
}

function walkLi(
  li: HTMLElement,
  ctx: Ctx,
  out: Entry[],
  offset: number,
): void {
  pushAt(out, li, ctx.line, offset);
  ctx.line++;
  // Crepe は li 直下に <div class="children"> を入れて、その中に
  // ネストした ul/ol を配置する。直接の子要素を見るだけでは検出できないので
  // div/span を再帰的に辿る。
  findNestedLists(li).forEach((nested) => walkBlock(nested, ctx, out, offset));
}

function findNestedLists(li: HTMLElement): HTMLElement[] {
  const out: HTMLElement[] = [];
  const visit = (el: HTMLElement) => {
    Array.from(el.children).forEach((c) => {
      const child = c as HTMLElement;
      const tag = child.tagName.toLowerCase();
      if (tag === "ul" || tag === "ol") {
        out.push(child);
      } else if (tag === "div" || tag === "span") {
        // Crepe の .children / .content-dom などラッパ内を再帰的に辿る
        visit(child);
      }
    });
  };
  visit(li);
  return out;
}

function findListItems(listEl: HTMLElement): HTMLElement[] {
  const out: HTMLElement[] = [];
  const visit = (el: HTMLElement) => {
    Array.from(el.children).forEach((c) => {
      const child = c as HTMLElement;
      const tag = child.tagName.toLowerCase();
      if (tag === "li") {
        out.push(child);
      } else if (tag === "div" || tag === "span") {
        visit(child);
      }
    });
  };
  visit(listEl);
  return out;
}

function findTableRows(tableEl: HTMLElement): HTMLElement[] {
  const out: HTMLElement[] = [];
  const thead = tableEl.querySelector<HTMLElement>("thead");
  if (thead) thead.querySelectorAll<HTMLElement>("tr").forEach((tr) => out.push(tr));
  const tbody = tableEl.querySelector<HTMLElement>("tbody");
  if (tbody) {
    tbody.querySelectorAll<HTMLElement>("tr").forEach((tr) => out.push(tr));
  } else if (!thead) {
    tableEl.querySelectorAll<HTMLElement>("tr").forEach((tr) => out.push(tr));
  }
  return out;
}

function pushAt(
  out: Entry[],
  el: HTMLElement,
  line: number | string,
  offset: number,
): void {
  const lineRect = getFirstLineRect(el);
  const rect = lineRect ?? el.getBoundingClientRect();
  if (rect.height === 0) return;
  out.push({
    top: Math.round(rect.top + offset),
    line,
    height: Math.max(1, Math.round(rect.height)),
  });
}

function getFirstLineRect(el: HTMLElement): DOMRect | null {
  const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
  let node: Node | null = walker.nextNode();
  while (node) {
    const text = node as Text;
    if (text.data.length > 0 && text.data.replace(/\s/g, "").length > 0) {
      const range = document.createRange();
      range.selectNodeContents(text);
      const rects = range.getClientRects();
      for (let i = 0; i < rects.length; i++) {
        if (rects[i].height > 0) return rects[i];
      }
    }
    node = walker.nextNode();
  }
  return null;
}

function isCodeBlock(el: HTMLElement): boolean {
  const tag = el.tagName.toLowerCase();
  if (tag === "pre") return true;
  if (el.classList.contains("cm-editor")) return true;
  if (el.querySelector(".cm-content") !== null) return true;
  return false;
}

function render(inner: HTMLElement, entries: Entry[]) {
  const existing = inner.children;
  for (let i = 0; i < entries.length; i++) {
    const e = entries[i];
    let el = existing[i] as HTMLElement | undefined;
    if (!el) {
      el = document.createElement("div");
      el.className = "line-no";
      inner.appendChild(el);
    }
    if (el.dataset.top !== String(e.top)) {
      el.style.top = `${e.top}px`;
      el.dataset.top = String(e.top);
    }
    if (el.dataset.h !== String(e.height)) {
      el.style.height = `${e.height}px`;
      el.style.lineHeight = `${e.height}px`;
      el.dataset.h = String(e.height);
    }
    const label = String(e.line);
    if (el.textContent !== label) el.textContent = label;
  }
  while (inner.children.length > entries.length) {
    inner.lastElementChild?.remove();
  }
}

export const LINE_GUTTER_WIDTH = GUTTER_WIDTH;
