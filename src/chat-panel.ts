/**
 * 右サイドのClaudeチャットパネル。
 * バックエンドは Claude Code CLI（サブスク認証）。Rust 側 chat_send が
 * `claude -p --output-format stream-json` を起動し、NDJSON を "chat-stream"
 * イベントで1行ずつ中継してくる。パースはこのモジュールで行う。
 *  - コンテキスト: 送信のたびにアクティブタブの全文を <document> タグで同梱。
 *  - 編集提案: <mdedit-proposal> マーカーで全文出力させ、diffプレビュー →
 *    承認で editor.setMarkdown() によりバッファへ適用（ディスクは触らない）。
 *  - 会話継続: result 行の session_id を保持して次回 --resume で渡す。
 * 表示/非表示は settings.showChatPanel を真実とし、購読で反応する。
 */
import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import MarkdownIt from "markdown-it";
import type { EditorHost } from "./editor";
import { store } from "./store";
import { settings, clampChatWidth } from "./settings";
import { t, onLangChange } from "./i18n";
import { diffLines, foldContext } from "./diff";
import { svg } from "./toolbar";
import { fileNameOf } from "./tabs";

type ChatStreamPayload = { reqId: number; line: string };
type ChatDonePayload = { reqId: number; code: number | null; stderrTail: string };

/**
 * 編集提案マーカー。system prompt（chat.rs）とペアで変更すること。
 * 本文は貪欲マッチ（[\s\S]*）: 提案する文書自体が行頭の </mdedit-proposal> を
 * 含む場合でも、最後の閉じマーカーまでを提案本文として扱う（提案は1返信1つで
 * 末尾に置かれる想定のため、非貪欲だと内側のマーカーで切れて文書が破損する）。
 */
const PROPOSAL_RE =
  /^<mdedit-proposal>[ \t]*\r?\n([\s\S]*)\r?\n<\/mdedit-proposal>[ \t]*$/m;
const PROPOSAL_OPEN_RE = /^<mdedit-proposal>/m;

const ICON_SEND = "m22 2-7 20-4-9-9-4zM22 2 11 13";
const ICON_STOP = "M7 7h10v10H7z";

/** チャット表示用の軽量markdownレンダラ（本文レンダリングの重い設定は使わない）。 */
const md = new MarkdownIt({ html: false, linkify: true, breaks: true });

export function createChatPanel(editor: EditorHost): void {
  const panel = document.getElementById("chat-panel");
  const resizer = document.getElementById("chat-resizer");
  if (!panel || !resizer) throw new Error("#chat-panel not found");

  // ── DOM 構築 ─────────────────────────────────────
  const header = document.createElement("div");
  header.className = "chat-header";
  const title = document.createElement("span");
  title.className = "chat-header-title";
  const newBtn = document.createElement("button");
  newBtn.className = "chat-header-btn";
  header.append(title, newBtn);

  const bannerHost = document.createElement("div");

  const messages = document.createElement("div");
  messages.className = "chat-messages";

  const inputRow = document.createElement("div");
  inputRow.className = "chat-input-row";
  const input = document.createElement("textarea");
  input.className = "chat-input";
  input.rows = 1;
  const sendBtn = document.createElement("button");
  sendBtn.className = "chat-send-btn";
  inputRow.append(input, sendBtn);

  panel.append(header, bannerHost, messages, inputRow);

  // ── 状態 ────────────────────────────────────────
  let sessionId: string | null = null;
  let currentReqId = 0;
  let busy = false;
  let cancelled = false;
  /** 送信対象にしたタブ（提案の適用先）。 */
  let targetTabId: string | null = null;
  /** ストリーミング中の応答テキスト蓄積。 */
  let streamBuf = "";
  /** result 行を受け取ったか（異常終了判定用）。 */
  let gotResult = false;
  /** result 行の is_error とエラーメッセージ。 */
  let resultError: string | null = null;
  let streamEl: HTMLElement | null = null;
  let renderScheduled = false;
  /** CLI の存在確認を実行済みか（パネル初回表示時に1回だけ行う）。 */
  let cliChecked = false;
  /** 実行中リクエストのユーザー入力（セッション消失時の自動再送用）。 */
  let inflightText = "";
  /** セッション消失での自動再送を行ったか（無限再送の防止）。 */
  let sessionRetried = false;
  /** ストリーム中に検出した提案マーカーの位置。-1=未検出。 */
  let proposalMarkerAt = -1;

  const applyLabels = () => {
    title.textContent = t("chat.title");
    newBtn.textContent = t("chat.new");
    input.placeholder = t("chat.placeholder");
    sendBtn.title = busy ? t("chat.stop") : t("chat.send");
  };

  const setBusy = (v: boolean) => {
    busy = v;
    sendBtn.classList.toggle("is-stop", v);
    sendBtn.innerHTML = svg(v ? ICON_STOP : ICON_SEND);
    sendBtn.title = v ? t("chat.stop") : t("chat.send");
  };
  setBusy(false);
  applyLabels();
  onLangChange(applyLabels);

  const scrollToBottom = () => {
    messages.scrollTop = messages.scrollHeight;
  };

  /** 下端付近を見ているときだけ自動追従する（読み返し中に引き戻さない）。 */
  const nearBottom = (): boolean =>
    messages.scrollHeight - messages.scrollTop - messages.clientHeight < 60;

  // ── バナー（エラー・案内） ────────────────────────
  const showBanner = (text: string, opts?: { error?: boolean; detail?: string }) => {
    bannerHost.replaceChildren();
    const banner = document.createElement("div");
    banner.className = "chat-banner" + (opts?.error ? " is-error" : "");
    banner.textContent = text;
    if (opts?.detail) {
      const pre = document.createElement("pre");
      pre.textContent = opts.detail;
      banner.appendChild(pre);
    }
    bannerHost.appendChild(banner);
  };
  const clearBanner = () => bannerHost.replaceChildren();

  // ── メッセージ描画 ────────────────────────────────
  const addUserMsg = (text: string) => {
    const el = document.createElement("div");
    el.className = "chat-msg is-user";
    el.textContent = text;
    messages.appendChild(el);
    scrollToBottom();
  };

  const startAssistantMsg = (): HTMLElement => {
    const el = document.createElement("div");
    el.className = "chat-msg is-assistant is-streaming";
    messages.appendChild(el);
    scrollToBottom();
    return el;
  };

  /**
   * ストリーミング中の表示。提案マーカー以降は隠して作成中の旨を出す。
   * マーカー検出後は表示部分が変化しないため再描画しない
   * （長い提案で毎フレーム全文を re-render するのを避ける）。
   */
  const renderStreaming = () => {
    if (!streamEl) return;
    if (proposalMarkerAt >= 0) return;
    proposalMarkerAt = streamBuf.search(PROPOSAL_OPEN_RE);
    const visible =
      proposalMarkerAt >= 0
        ? streamBuf.slice(0, proposalMarkerAt) + `\n*${t("chat.proposalTitle")}…*`
        : streamBuf;
    // 追従判定は内容を変更する「前」に行う（変更後だと伸びた分で常に不成立になる）
    const follow = nearBottom();
    streamEl.innerHTML = md.render(visible);
    if (follow) scrollToBottom();
  };

  const scheduleRender = () => {
    if (renderScheduled) return;
    renderScheduled = true;
    requestAnimationFrame(() => {
      renderScheduled = false;
      renderStreaming();
    });
  };

  // ── 編集提案カード ────────────────────────────────
  const buildDiffBox = (oldText: string, newText: string): HTMLElement => {
    const diff = diffLines(oldText, newText);
    const box = document.createElement("div");
    box.className = "chat-diff";
    if (diff === null) {
      const line = document.createElement("div");
      line.className = "diff-line diff-skip";
      line.textContent = t("chat.proposalWholeDoc");
      box.appendChild(line);
    } else {
      for (const l of foldContext(diff, 2)) {
        const line = document.createElement("div");
        line.className =
          "diff-line" +
          (l.kind === "add"
            ? " diff-add"
            : l.kind === "del"
              ? " diff-del"
              : l.kind === "skip"
                ? " diff-skip"
                : "");
        // 空行も1行分の高さを保つ
        line.textContent = l.text === "" ? " " : l.text;
        box.appendChild(line);
      }
    }
    return box;
  };

  const addProposalCard = (proposal: string, tabId: string) => {
    const card = document.createElement("div");
    card.className = "chat-proposal-card";

    const cardTitle = document.createElement("div");
    cardTitle.className = "chat-proposal-title";
    cardTitle.textContent = t("chat.proposalTitle");
    card.appendChild(cardTitle);

    // diff の比較元スナップショット。適用時に現バッファと照合し、
    // 提案表示後のユーザー編集を黙って巻き戻さないようにする。
    let diffBase = editor.getMarkdown(tabId) ?? "";
    let diffBox = buildDiffBox(diffBase, proposal);
    card.appendChild(diffBox);

    const actions = document.createElement("div");
    actions.className = "chat-proposal-actions";
    const applyBtn = document.createElement("button");
    applyBtn.className = "chat-header-btn is-primary";
    applyBtn.textContent = t("chat.apply");
    const discardBtn = document.createElement("button");
    discardBtn.className = "chat-header-btn";
    discardBtn.textContent = t("chat.discard");
    actions.append(applyBtn, discardBtn);
    card.appendChild(actions);

    const notice = document.createElement("div");
    notice.className = "chat-proposal-status";
    notice.hidden = true;
    card.appendChild(notice);

    const finish = (label: string) => {
      actions.remove();
      notice.hidden = false;
      notice.textContent = label;
    };
    applyBtn.addEventListener("click", () => {
      const now = editor.getMarkdown(tabId);
      if (now === null) {
        finish(t("chat.applyFailed"));
        return;
      }
      if (now !== diffBase) {
        // カード表示後に文書が編集された: diff を取り直して確認をやり直す
        diffBase = now;
        const fresh = buildDiffBox(diffBase, proposal);
        diffBox.replaceWith(fresh);
        diffBox = fresh;
        notice.hidden = false;
        notice.textContent = t("chat.diffRefreshed");
        return;
      }
      const ok = editor.setMarkdown(tabId, proposal);
      finish(ok ? t("chat.applied") : t("chat.applyFailed"));
    });
    discardBtn.addEventListener("click", () => finish(t("chat.discarded")));

    // スクロール追従は呼び出し元（finalizeAssistantMsg）が変更前の判定で行う。
    // カードは背が高く、追加後に nearBottom を測ると必ず不成立になるため。
    messages.appendChild(card);
  };

  /** ストリーム完了時: 本文の確定表示と提案カードの切り出し。 */
  const finalizeAssistantMsg = () => {
    if (!streamEl) return;
    // 追従判定は内容を変更する「前」に行う。本文確定＋カード追加で
    // 大きく伸びるため、変更後に測ると追従が必ず切れてカードが画面外に残る。
    const follow = nearBottom();
    streamEl.classList.remove("is-streaming");
    const m = PROPOSAL_RE.exec(streamBuf);
    let text = streamBuf;
    if (m) {
      text = text.replace(PROPOSAL_RE, "").trim();
    } else {
      // 停止などで閉じマーカーが無いまま終わった提案は、断片を
      // チャット欄に流出させず開きマーカー以降を落とす。
      const openAt = text.search(PROPOSAL_OPEN_RE);
      if (openAt >= 0) text = text.slice(0, openAt).trim();
    }
    if (text) {
      streamEl.innerHTML = md.render(text);
    } else {
      streamEl.remove();
    }
    if (m && targetTabId) addProposalCard(m[1], targetTabId);
    streamEl = null;
    if (follow) scrollToBottom();
  };

  // ── ストリームイベントのパース ─────────────────────
  const handleStreamLine = (line: string) => {
    let j: unknown;
    try {
      j = JSON.parse(line);
    } catch {
      return; // NDJSON 以外の行は無視
    }
    const o = j as Record<string, unknown>;
    switch (o.type) {
      case "system": {
        if (o.subtype === "init" && typeof o.session_id === "string") {
          sessionId = o.session_id;
        }
        break;
      }
      case "stream_event": {
        const ev = o.event as Record<string, unknown> | undefined;
        if (ev?.type === "content_block_delta") {
          const delta = ev.delta as Record<string, unknown> | undefined;
          if (delta?.type === "text_delta" && typeof delta.text === "string") {
            streamBuf += delta.text;
            scheduleRender();
          }
        }
        break;
      }
      case "assistant": {
        // ターン確定テキスト。delta の蓄積をこれで置き換えて正とする。
        const msg = o.message as Record<string, unknown> | undefined;
        const content = msg?.content;
        if (Array.isArray(content)) {
          const text = content
            .filter(
              (c): c is { type: string; text: string } =>
                !!c && (c as { type?: unknown }).type === "text",
            )
            .map((c) => c.text)
            .join("");
          if (text) {
            streamBuf = text;
            scheduleRender();
          }
        }
        break;
      }
      case "result": {
        gotResult = true;
        if (o.is_error === true) {
          resultError = typeof o.result === "string" ? o.result : "";
        } else if (typeof o.session_id === "string") {
          sessionId = o.session_id;
        }
        break;
      }
      default:
        break;
    }
  };

  // ── 完了処理・エラー分類 ─────────────────────────
  /** ログイン系のエラーメッセージなら専用の案内、それ以外は汎用エラーを出す。 */
  const showErrorFor = (detail: string) => {
    const key = /login|logged out|authenticat|api key|credential/i.test(detail)
      ? "chat.errLogin"
      : "chat.errGeneric";
    showBanner(t(key), { error: true, detail: detail.trim() });
  };

  const handleDone = (payload: ChatDonePayload) => {
    setBusy(false);
    finalizeAssistantMsg();
    if (cancelled) return; // ユーザー停止はエラー扱いしない

    if (resultError !== null) {
      // セッション消失: 破棄して同じメッセージを新規会話として一度だけ自動再送する。
      // 判定はCLIの定型文にのみ合致させる（"session" を含むだけの別エラーで
      // 会話文脈を捨てないため）。
      if (/no conversation found/i.test(resultError)) {
        sessionId = null;
        if (!sessionRetried && inflightText) {
          sessionRetried = true;
          showBanner(t("chat.errSessionLost"), { error: true });
          void dispatch(inflightText);
          return;
        }
      }
      showErrorFor(resultError + "\n" + payload.stderrTail);
      return;
    }
    if (!gotResult && payload.code !== 0) {
      showErrorFor(payload.stderrTail);
    }
  };

  // ── イベント購読（ウィンドウ単位・1回だけ） ─────────
  const win = getCurrentWindow();
  void win.listen<ChatStreamPayload>("chat-stream", (e) => {
    if (e.payload.reqId !== currentReqId) return; // 停止後の残イベントは捨てる
    handleStreamLine(e.payload.line);
  });
  void win.listen<ChatDonePayload>("chat-done", (e) => {
    if (e.payload.reqId !== currentReqId) return;
    handleDone(e.payload);
  });

  // ── 送信・停止・新しい会話 ─────────────────────────
  /**
   * 送信の実体（UI 追加はしない）。send() のほか、セッション消失時の
   * 自動再送（handleDone）からも呼ばれる。
   */
  const dispatch = async (text: string): Promise<void> => {
    const active = store.getActive();
    const tabId = active && active.kind !== "preview" ? active.id : null;
    const docMd = tabId ? editor.getMarkdown(tabId) : null;
    if (!active || tabId === null || docMd === null) {
      showBanner(t("chat.noTab"));
      return;
    }
    targetTabId = tabId;
    inflightText = text;
    const prompt = `<document title="${fileNameOf(active)}">\n${docMd}\n</document>\n\n${text}`;

    currentReqId++;
    cancelled = false;
    streamBuf = "";
    gotResult = false;
    resultError = null;
    proposalMarkerAt = -1;

    streamEl = startAssistantMsg();
    setBusy(true);
    // 停止・新規会話の直後は旧プロセスの後始末が終わっておらず "busy" が
    // 返ることがあるため、少し待って数回リトライする。
    for (let attempt = 0; ; attempt++) {
      try {
        await invoke("chat_send", {
          reqId: currentReqId,
          prompt,
          sessionId,
        });
        return;
      } catch (err) {
        const msg = String(err);
        if (msg.includes("busy") && attempt < 5) {
          await new Promise((r) => setTimeout(r, 300));
          continue;
        }
        setBusy(false);
        streamEl?.remove();
        streamEl = null;
        if (msg.includes("claude-not-found")) {
          showBanner(t("chat.errNotFound"), { error: true });
        } else {
          showBanner(t("chat.errGeneric"), { error: true, detail: msg });
        }
        return;
      }
    }
  };

  const send = async () => {
    const text = input.value.trim();
    if (!text || busy) return;
    const active = store.getActive();
    const tabId = active && active.kind !== "preview" ? active.id : null;
    if (tabId === null || editor.getMarkdown(tabId) === null) {
      showBanner(t("chat.noTab"));
      return;
    }
    clearBanner();
    sessionRetried = false;
    addUserMsg(text);
    input.value = "";
    autosize();
    await dispatch(text);
  };

  const stop = () => {
    cancelled = true;
    void invoke("chat_cancel").catch(() => {
      /* 既に終了していれば無視 */
    });
  };

  sendBtn.addEventListener("click", () => {
    if (busy) stop();
    else void send();
  });

  newBtn.addEventListener("click", () => {
    if (busy) stop();
    sessionId = null;
    inflightText = "";
    currentReqId++; // 以降、旧プロセスの残イベントを捨てる
    streamEl = null;
    setBusy(false);
    messages.replaceChildren();
    clearBanner();
    input.focus();
  });

  // Enter で送信、Shift+Enter で改行。IME 変換確定の Enter では送らない。
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey && !e.isComposing) {
      e.preventDefault();
      void send();
    }
  });

  const autosize = () => {
    input.style.height = "auto";
    input.style.height = `${Math.min(input.scrollHeight, 140)}px`;
  };
  input.addEventListener("input", autosize);

  // ── リサイザ（outline.ts の setupResizer を右基準に反転） ──
  const region = document.getElementById("editor-region");
  if (region) {
    let dragging = false;
    // ドラッグ中は右端が動かないため、pointerdown 時に1回だけ測る
    // （pointermove ごとの getBoundingClientRect はレイアウト計算を強制するため）。
    let regionRight = 0;
    const onMove = (e: PointerEvent) => {
      if (!dragging) return;
      // editor-region 右端からのオフセットを新しいパネル幅にする
      document.documentElement.style.setProperty(
        "--chat-w",
        `${clampChatWidth(regionRight - e.clientX)}px`,
      );
    };
    const onUp = (e: PointerEvent) => {
      if (!dragging) return;
      dragging = false;
      resizer.classList.remove("is-dragging");
      document.body.classList.remove("is-resizing-chat");
      try {
        resizer.releasePointerCapture(e.pointerId);
      } catch {
        /* noop */
      }
      resizer.removeEventListener("pointermove", onMove);
      resizer.removeEventListener("pointerup", onUp);
      resizer.removeEventListener("pointercancel", onUp);
      settings.setChatPanelWidth(regionRight - e.clientX);
    };
    resizer.addEventListener("pointerdown", (e) => {
      e.preventDefault();
      dragging = true;
      regionRight = region.getBoundingClientRect().right;
      resizer.classList.add("is-dragging");
      document.body.classList.add("is-resizing-chat");
      try {
        resizer.setPointerCapture(e.pointerId);
      } catch {
        /* noop */
      }
      resizer.addEventListener("pointermove", onMove);
      resizer.addEventListener("pointerup", onUp);
      resizer.addEventListener("pointercancel", onUp);
    });
  }

  // ── 表示制御（settings.showChatPanel を購読） ───────
  // プレゼン（スライドショー）中は実効非表示にする（outline と同方針）。
  const isPresentationActive = (): boolean => {
    const a = store.getActive();
    return a?.kind === "preview" && a.previewMode === "slideshow";
  };

  const applyVisibility = () => {
    const visible = settings.get().showChatPanel && !isPresentationActive();
    panel.classList.toggle("is-visible", visible);
    resizer.classList.toggle("is-visible", visible);
    // 初回表示時に CLI の存在確認をして、無ければ案内を出す
    if (visible && !cliChecked) {
      cliChecked = true;
      invoke<string>("chat_check").catch(() => {
        showBanner(t("chat.errNotFound"), { error: true });
      });
    }
  };
  applyVisibility();
  settings.subscribe(applyVisibility);
  let presActive = isPresentationActive();
  store.subscribe(() => {
    const now = isPresentationActive();
    if (now !== presActive) {
      presActive = now;
      applyVisibility();
    }
  });
}
