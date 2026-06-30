/**
 * プレゼンプレビュー。
 *
 * HTML出力と同一の文書HTML（exporter.ts の renderExportPreview が返す
 * <main class="document">…</main>）を受け取り、スライド単位に分割して
 * パワポ風に見せる。レンダリング自体は既存パイプラインに委ねるため、
 * 「ドキュメントプレビューと同じ見た目」がスライドでもそのまま保たれる。
 *
 * 3つのビューはすべて同じ「16:9キャンバス描画」を共有し、外側のレイアウトだけ
 * 切り替える:
 *   - デッキ: 左サイドバー（サムネ一覧）＋主ビュー1枚
 *   - グリッド: 全スライドをタイル表示
 *   - フルスクリーン: 1枚を画面いっぱいに表示して発表
 *
 * スライド分割（生mdは分割しない。`テキスト\n---` が setext H2 になる等で
 * 壊れるため、レンダリング済みDOMを分割する）:
 *   - <hr>（= `---`）があればそこを境界に分割（hr自体は区切りで内容ではない）
 *   - <hr> が無ければ H1/H2 を境界に分割（見出しは次スライドの先頭になる）
 *
 * スライド構造（3ゾーン・固定レイアウト）:
 *   - タイトル: 先頭の見出し（固定表示）
 *   - メッセージ: 見出し直後の最初の段落1つ（固定表示）
 *   - 本文: それ以降すべて（はみ出たら zoom で fit→下限超でゾーン内スクロール）
 */

import { t, onLangChange } from "./i18n";
// プレゼンのスタイルはこのモジュールと一緒に遅延ロードする（起動バンドルから除外）。
import "./styles/presentation.css";

/** 論理キャンバスサイズ（16:9固定）。外側スケールはこの座標系を変えない。 */
const CANVAS_W = 1280;
const CANVAS_H = 720;
/** 本文 fit の縮小下限。これを下回るとそのスライドだけ枠内スクロールにする。 */
const MIN_BODY_ZOOM = 0.55;
/** サイドバー幅の保存キーと可動範囲(px)。 */
const SIDEBAR_W_KEY = "pres-sidebar-w";
const SIDEBAR_W_MIN = 140;
const SIDEBAR_W_MAX = 460;
/** 一覧（グリッド）タイルの最小列幅(px)。Ctrl+ホイールで GRID_COL_STEP ずつ変える。 */
const GRID_COL_DEFAULT = 220;
const GRID_COL_MIN = 120;
const GRID_COL_MAX = 520;
const GRID_COL_STEP = 28;

/** 分割後の1スライド。3ゾーンに割り当て済みの要素を保持する。 */
type Slide = {
  /** 先頭見出し（無ければ null）。 */
  title: Element | null;
  /** 見出し直後の最初の段落（無ければ null）。 */
  message: Element | null;
  /** 残りの本文要素。 */
  body: Element[];
};

/** プレビュータブごとの現在スライド番号。更新（再生成）をまたいで保持する。 */
const lastIndexByTab = new Map<string, number>();

/** プレビュータブごとの言語切替リスナ解除関数。再マウント/タブ閉じで解除する。 */
const langUnsubByTab = new Map<string, () => void>();

/** プレビュータブごとの操作コントローラ（F5/Shift+F5・メニュー・コンテキストメニュー用）。 */
const controllers = new Map<
  string,
  {
    presentFrom(fromStart: boolean): void;
    toggleView(): void;
    toggleLaser(): void;
    present(): void;
    select(i: number): void;
    isGrid(): boolean;
    isFullscreen(): boolean;
    toolbar: HTMLElement;
  }
>();

/**
 * アプリ上部ツールバーへのプレゼン操作バー差し込みを同期するコールバック。
 * main.ts が登録し、タブ切替・プレゼン(再)マウント時に呼ばれる。
 * （presentation.ts → main.ts の循環 import を避けるための登録方式。）
 */
let chromeSync: (() => void) | null = null;
export function setPresentationChromeSync(fn: () => void): void {
  chromeSync = fn;
}

/** main.ts 用: 指定プレゼンの操作バー要素（アプリのツールバーへ差し込む）。 */
export function getPresentationToolbar(tabId: string): HTMLElement | null {
  return controllers.get(tabId)?.toolbar ?? null;
}

/** タブが閉じられたときに現在位置の記憶を破棄する（editor.ts から呼ぶ）。 */
export function forgetPresentationState(tabId: string): void {
  lastIndexByTab.delete(tabId);
  controllers.delete(tabId);
  langUnsubByTab.get(tabId)?.();
  langUnsubByTab.delete(tabId);
}

function isHeading(el: Element): boolean {
  return /^H[1-6]$/.test(el.tagName);
}

/**
 * 文書HTML文字列をパースして、テンプレートとなる <main class="document …">
 * とスライド配列を返す。main はクラス・テーマCSS変数を保持しており、各スライドの
 * キャンバスでクローンして使うことでテーマがそのまま効く。
 */
function parseSlides(html: string): { template: HTMLElement; slides: Slide[] } {
  const wrap = document.createElement("div");
  wrap.innerHTML = html;
  const main =
    wrap.querySelector<HTMLElement>("main.document") ??
    (() => {
      // 念のため: main が無ければ全体を document として包む。
      const m = document.createElement("main");
      m.className = "document";
      while (wrap.firstChild) m.appendChild(wrap.firstChild);
      return m;
    })();

  // スライド境界は「区切り線(---) もしくは 見出し1/2」のどちらでも成立する。
  //  - <hr>（= ---）: 区切りそのもの。current を確定して hr 自体は捨てる。
  //  - H1/H2: 次スライドの先頭になる（見出しはそのスライドに含める）。
  const els = Array.from(main.children);
  const groups: Element[][] = [];
  let current: Element[] = [];
  for (const el of els) {
    if (el.tagName === "HR") {
      groups.push(current);
      current = [];
      continue;
    }
    if (/^H[1-2]$/.test(el.tagName)) {
      if (current.length) groups.push(current);
      current = [el];
      continue;
    }
    current.push(el);
  }
  if (current.length) groups.push(current);

  const slides: Slide[] = groups
    .filter((g) => g.length > 0)
    .map((nodes) => {
      let i = 0;
      let title: Element | null = null;
      let message: Element | null = null;
      if (nodes[i] && isHeading(nodes[i])) {
        title = nodes[i];
        i++;
      }
      if (nodes[i] && nodes[i].tagName === "P") {
        message = nodes[i];
        i++;
      }
      return { title, message, body: nodes.slice(i) };
    });

  // テンプレート main は構造だけ使う（中身は空にする）。
  const template = main.cloneNode(false) as HTMLElement;
  return { template, slides };
}

/**
 * 1スライドの16:9キャンバスを生成する。
 * main(.document) を流用してテーマを適用し、ヘッダー（タイトル＋メッセージ）固定 ＋
 * 本文（fit/スクロール）の構造を作る。本文 fit は fitBody で後から計算する。
 */
function buildCanvas(slide: Slide, template: HTMLElement): HTMLElement {
  const canvas = document.createElement("div");
  canvas.className = "slide-canvas";

  const main = template.cloneNode(false) as HTMLElement;
  main.classList.add("slide-doc");
  // 見出し1で始まるスライドは「タイトルスライド」（中央寄せ・左揃え・特大タイトル）。
  if (slide.title && slide.title.tagName === "H1") {
    main.classList.add("slide-title-page");
  }

  const header = document.createElement("div");
  header.className = "slide-header";
  if (slide.title) header.appendChild(slide.title.cloneNode(true));
  if (slide.message) {
    const m = slide.message.cloneNode(true) as HTMLElement;
    m.classList.add("slide-message");
    header.appendChild(m);
  }

  const body = document.createElement("div");
  body.className = "slide-body";
  const inner = document.createElement("div");
  inner.className = "slide-body-inner";
  for (const n of slide.body) inner.appendChild(n.cloneNode(true));
  body.appendChild(inner);

  main.appendChild(header);
  main.appendChild(body);
  canvas.appendChild(main);
  return canvas;
}

/**
 * 本文ゾーンが枠に収まるよう zoom を調整する。
 * zoom は（transform と違い）レイアウト・スクロール量に反映されるため、
 * 下限到達時のゾーン内スクロールが自然に効く。キャンバスは論理1280×720で固定の
 * ため、外側スケールには依存しない。表示サイズが確定してから計算する。
 */
function fitBody(canvas: HTMLElement): void {
  const body = canvas.querySelector<HTMLElement>(".slide-body");
  const inner = canvas.querySelector<HTMLElement>(".slide-body-inner");
  if (!body || !inner) return;
  inner.style.zoom = "1";
  body.classList.remove("scrollable");
  const avail = body.clientHeight;
  // 本文の実高さは body 側の scrollHeight で測る。body は overflow:hidden で
  // BFC を作るため、最後の子要素の margin-bottom が body の領域に含まれる。
  // inner.scrollHeight はこの末尾マージンを取りこぼし、必要な縮小量を過小評価して
  // 末尾（最後の段落）が枠下に数px はみ出して見切れていた。
  const content = body.scrollHeight;
  if (avail <= 0 || content <= avail) return;
  const z = avail / content;
  if (z < MIN_BODY_ZOOM) {
    inner.style.zoom = String(MIN_BODY_ZOOM);
    body.classList.add("scrollable");
  } else {
    inner.style.zoom = String(z);
  }
}

/**
 * キャンバスをフレームに収め、フレームサイズに合わせて transform で拡縮する。
 * 戻り値はフレーム要素。ResizeObserver で外側スケールを追従し、表示サイズが
 * 確定したタイミングで本文 fit を計算する。
 */
function mountCanvas(slide: Slide, template: HTMLElement): HTMLElement {
  const frame = document.createElement("div");
  frame.className = "slide-frame";
  const canvas = buildCanvas(slide, template);
  frame.appendChild(canvas);

  let fitted = false;
  const apply = () => {
    const fw = frame.clientWidth;
    const fh = frame.clientHeight;
    if (fw <= 0 || fh <= 0) return;
    const scale = Math.min(fw / CANVAS_W, fh / CANVAS_H);
    canvas.style.transform = `translate(-50%, -50%) scale(${scale})`;
    if (!fitted) {
      fitBody(canvas);
      fitted = true;
    }
  };
  const ro = new ResizeObserver(() => apply());
  ro.observe(frame);
  // 画像の読み込み完了で本文高さが変わるため、その都度 fit を取り直す。
  canvas.querySelectorAll("img").forEach((img) => {
    if (!img.complete) {
      img.addEventListener(
        "load",
        () => {
          fitted = false;
          apply();
        },
        { once: true },
      );
    }
  });
  requestAnimationFrame(apply);
  return frame;
}

/**
 * クリック可能なサムネイル。サイドバー（固定幅）でもグリッド（可変幅）でも、
 * 主ビューと同じ mountCanvas（フレーム＋ResizeObserver方式）で表示サイズに追従させる。
 * これにより一覧モードで拡大してもスライドが重ならない。
 */
function buildThumb(slide: Slide, template: HTMLElement, index: number): HTMLElement {
  const thumb = document.createElement("button");
  thumb.type = "button";
  thumb.className = "slide-thumb";
  thumb.dataset.index = String(index);
  thumb.appendChild(mountCanvas(slide, template));

  const num = document.createElement("span");
  num.className = "slide-thumb-num";
  num.textContent = String(index + 1);
  thumb.appendChild(num);
  return thumb;
}

/** サイドバーの右端ハンドルでドラッグして幅を変える。幅は localStorage に保存。 */
function attachSidebarResizer(handle: HTMLElement, sidebar: HTMLElement): void {
  let startX = 0;
  let startW = 0;
  const onMove = (e: PointerEvent) => {
    const w = Math.min(
      SIDEBAR_W_MAX,
      Math.max(SIDEBAR_W_MIN, startW + (e.clientX - startX)),
    );
    sidebar.style.width = `${w}px`;
  };
  const onUp = () => {
    handle.classList.remove("dragging");
    window.removeEventListener("pointermove", onMove);
    window.removeEventListener("pointerup", onUp);
    try {
      localStorage.setItem(SIDEBAR_W_KEY, String(Math.round(sidebar.clientWidth)));
    } catch {
      // 保存失敗は無視（次回は既定幅）。
    }
  };
  handle.addEventListener("pointerdown", (e) => {
    e.preventDefault();
    startX = e.clientX;
    startW = sidebar.clientWidth;
    handle.classList.add("dragging");
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  });
}

function mkToolBtn(label: string, tooltip?: string): HTMLButtonElement {
  const b = document.createElement("button");
  b.type = "button";
  b.className = "pres-btn";
  b.textContent = label;
  if (tooltip) b.title = tooltip;
  return b;
}

/**
 * プレゼンUIをコンテナにマウントする。
 * @param container プレビューペイン要素（editor.ts の makePreview が用意）
 * @param html      文書HTML（renderExportPreview の出力。document mode と共通）
 * @param tabId     現在スライド番号の保持に使う
 */
export function mountPresentation(
  container: HTMLElement,
  html: string,
  tabId: string,
): void {
  const { template, slides } = parseSlides(html);
  container.classList.add("presentation-host");
  // 同じタブの再マウント時は、前回の言語切替リスナを解除しておく（多重登録を防ぐ）。
  langUnsubByTab.get(tabId)?.();
  langUnsubByTab.delete(tabId);

  const root = document.createElement("div");
  root.className = "presentation";
  root.tabIndex = 0;

  // ── ツールバー（アプリの上部ツールバーへ差し込むためペインには付けない） ──
  const toolbar = document.createElement("div");
  toolbar.className = "pres-toolbar";
  // 各ボタンには名称＋ショートカットのツールチップ（title属性）を付ける。
  const btnDeck = mkToolBtn(t("pres.deckView"), `${t("pres.deckView")} (G)`);
  const btnGrid = mkToolBtn(t("pres.gridView"), `${t("pres.gridView")} (G)`);
  const counter = document.createElement("span");
  counter.className = "pres-counter";
  const btnPrev = mkToolBtn("‹", `${t("pres.prev")} (←)`);
  const btnNext = mkToolBtn("›", `${t("pres.next")} (→)`);
  const btnLaser = mkToolBtn(t("pres.laser"), `${t("pres.laser")} (L)`);
  const btnFull = mkToolBtn(t("pres.fullscreen"), `${t("pres.fullscreen")} (F / F5)`);
  // デッキボタンの左に区切り線（操作バーの先頭）。
  const leadSep = document.createElement("span");
  leadSep.className = "pres-sep";
  toolbar.append(leadSep, btnDeck, btnGrid, btnPrev, counter, btnNext, btnLaser, btnFull);

  // ── デッキ（サイドバー＋主ビュー）──
  const deck = document.createElement("div");
  deck.className = "pres-deck";
  const sidebar = document.createElement("aside");
  sidebar.className = "pres-sidebar";
  // 保存済みのサイドバー幅を復元する。
  const savedW = Number(
    (() => {
      try {
        return localStorage.getItem(SIDEBAR_W_KEY);
      } catch {
        return null;
      }
    })(),
  );
  if (savedW >= SIDEBAR_W_MIN && savedW <= SIDEBAR_W_MAX) {
    sidebar.style.width = `${savedW}px`;
  }
  const resizer = document.createElement("div");
  resizer.className = "pres-sidebar-resizer";
  const mainView = document.createElement("div");
  mainView.className = "pres-mainview";
  deck.append(sidebar, resizer, mainView);
  attachSidebarResizer(resizer, sidebar);

  // ── グリッド ──
  const grid = document.createElement("div");
  grid.className = "pres-grid";

  // toolbar はアプリ上部ツールバーへ main.ts 側が差し込む（ペインには deck/grid のみ）。
  root.append(deck, grid);
  container.appendChild(root);

  const total = slides.length;
  let index = Math.min(
    Math.max(0, lastIndexByTab.get(tabId) ?? 0),
    Math.max(0, total - 1),
  );
  let view: "deck" | "grid" = "deck";

  // ── フルスクリーン発表（前方参照のため先に宣言） ──
  let fsOverlay: HTMLElement | null = null;
  let fsFrame: HTMLElement | null = null;
  // 発表終了画面（PowerPoint風）。最終スライドからさらに「次へ」で true になり、
  // 黒画面を表示する。フルスクリーン専用の状態で、デッキ/グリッドの index には影響しない。
  let atEnd = false;

  // ── レーザーポインタ ──
  // マウス位置に赤い光点を追従させ、スライド上のカーソルは隠す。
  // フルスクリーン時は表示されるのがオーバーレイのサブツリーだけのため、点も
  // オーバーレイ配下へ移す。マウス位置は常時記録し、再有効化時に現在位置へ出す。
  let laserOn = false;
  let lastX = -9999;
  let lastY = -9999;
  const laserDot = document.createElement("div");
  laserDot.className = "pres-laser";
  const laserHost = (): HTMLElement => fsOverlay ?? root;
  const positionDot = () => {
    laserDot.style.left = `${lastX}px`;
    laserDot.style.top = `${lastY}px`;
  };
  root.addEventListener("pointermove", (e) => {
    lastX = e.clientX;
    lastY = e.clientY;
    if (laserOn) positionDot();
  });
  const setLaser = (on: boolean) => {
    laserOn = on;
    btnLaser.classList.toggle("active", on);
    root.classList.toggle("laser-on", on);
    if (on) {
      laserHost().appendChild(laserDot);
      positionDot(); // 有効化した瞬間に現在のカーソル位置へ出す。
    } else {
      laserDot.remove();
    }
  };
  const toggleLaser = () => {
    if (view === "grid") return; // 一覧モードでは無効。
    setLaser(!laserOn);
  };

  // 発表終了画面（黒背景）。クリックでも終了（先頭へ）できる。
  const buildEndScreen = (): HTMLElement => {
    const end = document.createElement("div");
    end.className = "pres-end";
    const title = document.createElement("div");
    title.className = "pres-end-title";
    title.textContent = t("pres.endTitle");
    const hint = document.createElement("div");
    hint.className = "pres-end-hint";
    hint.textContent = t("pres.endHint");
    end.append(title, hint);
    end.addEventListener("click", () => goNext());
    return end;
  };

  const renderFullscreen = () => {
    if (!fsOverlay) return;
    fsOverlay.innerHTML = "";
    if (total === 0) return;
    // 終了画面はスライドを描かず黒画面のみ（レーザーも出さない）。
    if (atEnd) {
      fsOverlay.appendChild(buildEndScreen());
      return;
    }
    fsFrame = mountCanvas(slides[index], template);
    fsOverlay.appendChild(fsFrame);
    // innerHTML クリアで外れるので、点が有効なら貼り直す。
    if (laserOn) {
      fsOverlay.appendChild(laserDot);
      positionDot();
    }
  };

  // サムネ（サイドバー）とタイル（グリッド）を一度だけ生成する。
  // サイドバー: クリックでそのスライドを主ビューに表示。
  const thumbs: HTMLElement[] = slides.map((s, i) => {
    const th = buildThumb(s, template, i);
    th.addEventListener("click", () => setIndex(i));
    sidebar.appendChild(th);
    return th;
  });
  // 一覧（グリッド）: シングルクリックで選択（一覧のまま）、ダブルクリックでデッキ表示。
  const tiles: HTMLElement[] = slides.map((s, i) => {
    const tile = buildThumb(s, template, i);
    tile.classList.add("slide-tile");
    tile.addEventListener("click", () => setIndex(i));
    tile.addEventListener("dblclick", () => {
      setIndex(i);
      setView("deck");
    });
    grid.appendChild(tile);
    return tile;
  });

  const renderMain = () => {
    mainView.innerHTML = "";
    if (total === 0) {
      mainView.innerHTML = `<div class="pres-empty">${t("pres.empty")}</div>`;
      return;
    }
    mainView.appendChild(mountCanvas(slides[index], template));
  };

  const updateChrome = () => {
    counter.textContent = total ? `${index + 1} / ${total}` : "0 / 0";
    thumbs.forEach((th, i) => th.classList.toggle("active", i === index));
    tiles.forEach((tile, i) => tile.classList.toggle("active", i === index));
    btnDeck.classList.toggle("active", view === "deck");
    btnGrid.classList.toggle("active", view === "grid");
    btnPrev.disabled = total === 0 || index <= 0;
    btnNext.disabled = total === 0 || index >= total - 1;
    btnFull.disabled = total === 0;
    // レーザーは一覧モードでは不要のため無効化する。
    btnLaser.disabled = total === 0 || view === "grid";
  };

  const ensureThumbVisible = () => {
    thumbs[index]?.scrollIntoView({ block: "nearest" });
  };

  function setIndex(i: number): void {
    const next = Math.min(Math.max(0, i), Math.max(0, total - 1));
    if (next === index && mainView.childElementCount > 0) {
      updateChrome();
      return;
    }
    index = next;
    lastIndexByTab.set(tabId, index);
    renderMain();
    updateChrome();
    ensureThumbVisible();
    if (fsOverlay) renderFullscreen();
  }

  function setView(v: "deck" | "grid"): void {
    view = v;
    // 一覧モードではレーザーは使わないので消す。
    if (v === "grid" && laserOn) setLaser(false);
    root.classList.toggle("view-grid", v === "grid");
    updateChrome();
    if (v === "grid") {
      tiles[index]?.scrollIntoView({ block: "nearest" });
    } else {
      ensureThumbVisible();
    }
  }

  const exitFullscreen = () => {
    if (document.fullscreenElement) {
      void document.exitFullscreen().catch(() => {});
    }
    fsOverlay?.remove();
    fsOverlay = null;
    fsFrame = null;
    atEnd = false;
    // 発表終了後もレーザーが有効なら、点を root 側へ戻す（オーバーレイ破棄で外れるため）。
    if (laserOn) {
      root.appendChild(laserDot);
      positionDot();
    }
    root.focus({ preventScroll: true });
  };

  const enterFullscreen = () => {
    if (total === 0) return;
    atEnd = false;
    if (fsOverlay) {
      // すでに発表中なら現在スライドを描き直すだけ（多重オーバーレイを防ぐ）。
      renderFullscreen();
      return;
    }
    // 発表は常にデッキ基準（一覧から入った場合もデッキへ。レーザー等を使えるように）。
    if (view !== "deck") setView("deck");
    fsOverlay = document.createElement("div");
    fsOverlay.className = "pres-fullscreen";
    // フォーカスを受けられるようにする。キー操作は子→root へバブリングして
    // root の onKey が1回だけ処理する（オーバーレイに別リスナを付けると二重発火する）。
    fsOverlay.tabIndex = 0;
    root.appendChild(fsOverlay);
    renderFullscreen();
    const onFsChange = () => {
      if (!document.fullscreenElement) {
        document.removeEventListener("fullscreenchange", onFsChange);
        exitFullscreen();
      }
    };
    document.addEventListener("fullscreenchange", onFsChange);
    const overlay = fsOverlay;
    void overlay.requestFullscreen?.().catch(() => {
      // フルスクリーンAPIが使えない環境ではオーバーレイ表示のみで代替する。
    });
    // フルスクリーン中でもキー操作を確実に受けるためフォーカスをオーバーレイへ。
    requestAnimationFrame(() => overlay.focus({ preventScroll: true }));
  };

  // ── ページ送り（キー・ホイール・終了画面クリックで共通利用）──
  // フルスクリーンでは PowerPoint 風に「最終スライド→次へ」で終了画面、さらに
  // 「次へ」でフルスクリーン解除して先頭(P1)へ戻る。
  function goNext(): void {
    if (fsOverlay) {
      if (atEnd) {
        // 終了画面からさらに進む → 発表を終え、先頭へ戻る。
        exitFullscreen();
        setIndex(0);
        return;
      }
      if (index >= total - 1) {
        atEnd = true;
        renderFullscreen();
        return;
      }
    }
    setIndex(index + 1);
  }
  function goPrev(): void {
    if (fsOverlay && atEnd) {
      // 終了画面から戻る → 最終スライドを再表示。
      atEnd = false;
      renderFullscreen();
      return;
    }
    setIndex(index - 1);
  }
  // Home/End 等の直接ジャンプ。終了画面からのジャンプも実スライドへ確実に戻す。
  function jumpTo(target: number): void {
    const wasEnd = atEnd;
    atEnd = false;
    const clamped = Math.min(Math.max(0, target), Math.max(0, total - 1));
    // 終了画面から同じ index へ戻る場合、setIndex は早期 return するため明示再描画する。
    if (fsOverlay && wasEnd && clamped === index) {
      renderFullscreen();
      return;
    }
    setIndex(clamped);
  }

  // ── 操作配線 ──
  btnDeck.addEventListener("click", () => setView("deck"));
  btnGrid.addEventListener("click", () => setView("grid"));
  btnPrev.addEventListener("click", () => setIndex(index - 1));
  btnNext.addEventListener("click", () => setIndex(index + 1));
  btnLaser.addEventListener("click", () => toggleLaser());
  btnFull.addEventListener("click", () => enterFullscreen());

  function onKey(e: KeyboardEvent): void {
    const k = e.key;
    if (k === "ArrowRight" || k === "ArrowDown" || k === "PageDown" || k === " ") {
      e.preventDefault();
      goNext();
    } else if (k === "ArrowLeft" || k === "ArrowUp" || k === "PageUp") {
      e.preventDefault();
      goPrev();
    } else if (k === "Home") {
      e.preventDefault();
      jumpTo(0);
    } else if (k === "End") {
      e.preventDefault();
      jumpTo(total - 1);
    } else if (k === "g" || k === "G") {
      e.preventDefault();
      setView(view === "grid" ? "deck" : "grid");
    } else if (k === "l" || k === "L") {
      e.preventDefault();
      toggleLaser();
    } else if (k === "f" || k === "F" || (k === "Enter" && !fsOverlay)) {
      e.preventDefault();
      enterFullscreen();
    } else if (k === "Escape") {
      if (fsOverlay) {
        e.preventDefault();
        exitFullscreen();
      } else if (view === "grid") {
        e.preventDefault();
        setView("deck");
      }
    }
  }

  root.addEventListener("keydown", onKey);

  // クリックでフォーカスを取り、キー操作を有効にする。
  root.addEventListener("mousedown", () => {
    if (!fsOverlay) root.focus({ preventScroll: true });
  });

  // 一覧（グリッド）モードの Ctrl+ホイールでタイルの大きさを拡大縮小する。
  let gridCol = GRID_COL_DEFAULT;
  const applyGridCols = () => {
    grid.style.gridTemplateColumns = `repeat(auto-fill, minmax(${gridCol}px, 1fr))`;
  };
  applyGridCols();

  // ホイール操作。Ctrl 押下時はズーム（グリッド時のみタイル拡縮）、
  // 押下なしのデッキモードではホイールでページ移動。
  let wheelLock = false;
  root.addEventListener(
    "wheel",
    (e) => {
      if (e.ctrlKey) {
        // 既定のブラウザズームを抑止。
        e.preventDefault();
        // フルスクリーン/デッキ主ビューで、カーソル下に縮小下限を超えてスクロール可能に
        // なった本文（.slide-body.scrollable）があれば、その領域だけをスクロールする。
        // グリッドのサムネは pointer-events:none で拾わないが、念のため view で除外する。
        const scrollable = (e.target as Element | null)?.closest?.(
          ".slide-body.scrollable",
        ) as HTMLElement | null;
        if (scrollable && view !== "grid") {
          scrollable.scrollTop += e.deltaY;
          return;
        }
        // グリッドのときだけタイルサイズを変える。
        if (view === "grid") {
          gridCol = Math.min(
            GRID_COL_MAX,
            Math.max(GRID_COL_MIN, gridCol + (e.deltaY > 0 ? -GRID_COL_STEP : GRID_COL_STEP)),
          );
          applyGridCols();
        }
        return;
      }
      // ホイールでページ移動。
      //  - フルスクリーン発表中: どこでも送れる。
      //  - デッキモード: 主ビュー上のみ（サイドバーは通常スクロール）。
      //  - 一覧モード: 送らない（タイル一覧の通常スクロールに任せる）。
      const overMain = !!(e.target as Element | null)?.closest?.(".pres-mainview");
      if (!fsOverlay && (view !== "deck" || !overMain)) return;
      e.preventDefault();
      if (wheelLock) return;
      wheelLock = true;
      setTimeout(() => {
        wheelLock = false;
      }, 160);
      if (e.deltaY > 0) goNext();
      else goPrev();
    },
    { passive: false },
  );

  // F5/Shift+F5・表示メニュー（Alt+V→D）から操作するためのコントローラを登録する。
  controllers.set(tabId, {
    presentFrom(fromStart: boolean) {
      if (fromStart) setIndex(0);
      enterFullscreen();
    },
    toggleView() {
      setView(view === "grid" ? "deck" : "grid");
    },
    toggleLaser() {
      toggleLaser();
    },
    present() {
      enterFullscreen();
    },
    select(i: number) {
      setIndex(i);
    },
    isGrid() {
      return view === "grid";
    },
    isFullscreen() {
      return !!fsOverlay;
    },
    toolbar,
  });

  // 言語切替時、操作バーのボタン名・ツールチップ・空状態テキストを貼り直す。
  // （メニューバー同様、t() は生成時に評価されるため明示的な再適用が要る。）
  const applyLang = () => {
    btnDeck.textContent = t("pres.deckView");
    btnDeck.title = `${t("pres.deckView")} (G)`;
    btnGrid.textContent = t("pres.gridView");
    btnGrid.title = `${t("pres.gridView")} (G)`;
    btnPrev.title = `${t("pres.prev")} (←)`;
    btnNext.title = `${t("pres.next")} (→)`;
    btnLaser.textContent = t("pres.laser");
    btnLaser.title = `${t("pres.laser")} (L)`;
    btnFull.textContent = t("pres.fullscreen");
    btnFull.title = `${t("pres.fullscreen")} (F / F5)`;
    if (total === 0) renderMain();
  };
  langUnsubByTab.set(tabId, onLangChange(applyLang));

  // 初期表示。
  renderMain();
  setView("deck");
  updateChrome();
  ensureThumbVisible();
  requestAnimationFrame(() => root.focus({ preventScroll: true }));
  // アプリ上部ツールバーへこのプレゼンの操作バーを差し込む（main.ts が同期）。
  chromeSync?.();
}

/** F5/Shift+F5 用: 指定プレビュータブの発表を開始する（fromStart=先頭から）。 */
export function startPresentation(tabId: string, fromStart: boolean): boolean {
  const c = controllers.get(tabId);
  if (!c) return false;
  c.presentFrom(fromStart);
  return true;
}

/** 表示メニュー（Alt+V→D）・コンテキストメニュー用: デッキ／一覧モードを切り替える。 */
export function togglePresentationView(tabId: string): boolean {
  const c = controllers.get(tabId);
  if (!c) return false;
  c.toggleView();
  return true;
}

/** コンテキストメニュー用: レーザーポインタを切り替える。 */
export function togglePresentationLaser(tabId: string): boolean {
  const c = controllers.get(tabId);
  if (!c) return false;
  c.toggleLaser();
  return true;
}

/** コンテキストメニュー用: 指定スライドを選択する（タイル右クリック時など）。 */
export function selectPresentationSlide(tabId: string, index: number): void {
  controllers.get(tabId)?.select(index);
}

/** コンテキストメニュー用: 現在そのプレゼンが一覧（グリッド）モードか。 */
export function isPresentationGridView(tabId: string): boolean {
  return controllers.get(tabId)?.isGrid() ?? false;
}

/** コンテキストメニュー用: 現在そのプレゼンがフルスクリーン発表中か。 */
export function isPresentationFullscreen(tabId: string): boolean {
  return controllers.get(tabId)?.isFullscreen() ?? false;
}
