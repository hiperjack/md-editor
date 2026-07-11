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
import { showContextMenu, type MenuItem } from "./context-menu";

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

/**
 * このウィンドウのチャットが会話対象にしているタブかの判定。
 * createChatPanel が実体を登録する（1ウィンドウ1パネル前提）。
 * actions.ts の「起動直後の空タブを転用する」処理が、チャットで使用中の
 * Untitled タブを黙って開いたファイルに置き換えないために参照する。
 */
let inUseCheck: ((tabId: string) => boolean) | null = null;

export function isChatTabInUse(tabId: string): boolean {
  return inUseCheck?.(tabId) ?? false;
}

/** チャット表示用の軽量markdownレンダラ（本文レンダリングの重い設定は使わない）。 */
const md = new MarkdownIt({ html: false, linkify: true, breaks: true });

export type ChatPanel = {
  /** パネルの開閉をトグルする（開閉状態は永続化しない）。 */
  toggle: () => void;
  /** パネルを開いているか（ツールバーボタンの active 同期用）。 */
  isVisible: () => boolean;
};

export function createChatPanel(editor: EditorHost): ChatPanel {
  const panel = document.getElementById("chat-panel");
  const resizer = document.getElementById("chat-resizer");
  if (!panel || !resizer) throw new Error("#chat-panel not found");

  // ── DOM 構築 ─────────────────────────────────────
  const header = document.createElement("div");
  header.className = "chat-header";
  const title = document.createElement("span");
  title.className = "chat-header-title";
  const historyBtn = document.createElement("button");
  historyBtn.className = "chat-header-btn";
  const newBtn = document.createElement("button");
  newBtn.className = "chat-header-btn";
  header.append(title, historyBtn, newBtn);

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
  /**
   * assistant イベントで確定した各メッセージのテキスト。
   * Web検索などのツール使用時は1応答が複数のassistantメッセージに分かれるため、
   * 最終表示はこれを結合して正とする（delta蓄積は区切りが失われる）。
   */
  let confirmedTexts: string[] = [];
  /** ツール実行中（Web検索中）の表示フラグ。 */
  let searching = false;

  // ── 会話履歴の永続化（複数会話・切替可能） ─────────────
  // main ウィンドウのみ永続化する（tab-* はラベルが起動ごとに変わるため
  // 復元先がなく、localStorage にキーのゴミが溜まるだけになる）。
  // 「新しい会話」は削除ではなくアーカイブで、履歴ボタンから再開できる。
  type ChatHistoryMsg = { role: "user" | "assistant"; text: string };
  type ChatConversation = {
    id: string;
    /** 一覧表示用。最初のユーザーメッセージの先頭。 */
    title: string;
    sessionId: string | null;
    messages: ChatHistoryMsg[];
    updatedAt: number;
  };
  type ChatStore = {
    /** 起動時に復元する会話。null なら空の状態で開始。 */
    activeId: string | null;
    conversations: ChatConversation[];
  };

  const history: ChatHistoryMsg[] = [];
  const winLabel = getCurrentWindow().label;
  const STORE_KEY = `mdedit.chat.v2.${winLabel}`;
  const LEGACY_KEY = `mdedit.chat.v1.${winLabel}`;
  const persistable = winLabel === "main";
  const HISTORY_MAX = 50; // 1会話あたりの保存メッセージ数
  const CONV_MAX = 20; // 保存する会話数（古いものから捨てる）

  let convId: string = crypto.randomUUID();

  const loadStore = (): ChatStore => {
    try {
      const raw = localStorage.getItem(STORE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as ChatStore;
        if (Array.isArray(parsed.conversations)) return parsed;
      }
    } catch {
      // 壊れたストアは無視して空で開始
    }
    return { activeId: null, conversations: [] };
  };

  const saveStore = (s: ChatStore) => {
    if (!persistable) return;
    try {
      localStorage.setItem(STORE_KEY, JSON.stringify(s));
    } catch {
      // 容量超過等は黙って諦める（履歴はベストエフォート）
    }
  };

  /** 現在の会話をストアへ upsert する（メッセージが無ければ何もしない）。 */
  const saveHistory = () => {
    if (!persistable || history.length === 0) return;
    const s = loadStore();
    const conv: ChatConversation = {
      id: convId,
      title:
        (history.find((m) => m.role === "user")?.text ?? "").slice(0, 40) ||
        "…",
      sessionId,
      messages: history.slice(-HISTORY_MAX),
      updatedAt: Date.now(),
    };
    const rest = s.conversations.filter((c) => c.id !== convId);
    rest.unshift(conv);
    rest.sort((a, b) => b.updatedAt - a.updatedAt);
    saveStore({ activeId: convId, conversations: rest.slice(0, CONV_MAX) });
  };

  const applyLabels = () => {
    title.textContent = t("chat.title");
    historyBtn.textContent = t("chat.history");
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
  /** DOMへの描画のみ（履歴復元でも使う）。 */
  const renderUserMsg = (text: string) => {
    const el = document.createElement("div");
    el.className = "chat-msg is-user";
    el.textContent = text;
    messages.appendChild(el);
  };

  /** DOMへの描画のみ（履歴復元でも使う）。 */
  const renderAssistantMsg = (text: string) => {
    const el = document.createElement("div");
    el.className = "chat-msg is-assistant";
    el.innerHTML = md.render(text);
    messages.appendChild(el);
  };

  const addUserMsg = (text: string) => {
    renderUserMsg(text);
    scrollToBottom();
    history.push({ role: "user", text });
    saveHistory();
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
    let visible =
      proposalMarkerAt >= 0
        ? streamBuf.slice(0, proposalMarkerAt) + `\n*${t("chat.proposalTitle")}…*`
        : streamBuf;
    if (searching) visible += `\n\n*${t("chat.searching")}*`;
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

    messages.appendChild(card);
    // 提案カードは応答の主目的なので、読み位置に関わらず必ず全体を見せる
    // （nearest: 既に見えていれば動かさず、下に隠れていれば必要な分だけ出す）。
    card.scrollIntoView({ block: "nearest" });
  };

  /** ストリーム完了時: 本文の確定表示と提案カードの切り出し。 */
  const finalizeAssistantMsg = () => {
    if (!streamEl) return;
    // ツール使用時は複数のassistantメッセージに分かれるため、確定テキストの
    // 結合を正とする（delta蓄積はメッセージ間の区切りが失われている）。
    if (confirmedTexts.length > 0) streamBuf = confirmedTexts.join("\n\n");
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
    // 履歴へ確定テキストを記録（編集提案カードは適用先タブが再起動で
    // 失われるため永続化しない）。sessionId の更新も一緒に保存される。
    if (text) history.push({ role: "assistant", text });
    saveHistory();
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
            searching = false;
            streamBuf += delta.text;
            scheduleRender();
          }
        } else if (ev?.type === "content_block_start") {
          // ツールブロックの開始（Web検索など）。次のテキストが来るまで
          // 「検索中…」を表示する。
          const block = ev.content_block as Record<string, unknown> | undefined;
          if (typeof block?.type === "string" && block.type.includes("tool_use")) {
            searching = true;
            scheduleRender();
          }
        }
        break;
      }
      case "assistant": {
        // メッセージ単位の確定テキスト。ツール使用時は複数回届くため
        // 蓄積し、最終表示は finalize で結合する。
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
          if (text) confirmedTexts.push(text);
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
    // 選択中のテキストがあれば <selection> として同梱する
    // （「ここを書き直して」等が選択範囲を指すことをモデルに伝える）
    const selection = (editor.getSelectionText(tabId) ?? "").trim();
    const selPart = selection
      ? `\n\n<selection>\n${selection}\n</selection>`
      : "";
    const prompt = `<document title="${fileNameOf(active)}">\n${docMd}\n</document>${selPart}\n\n${text}`;

    currentReqId++;
    cancelled = false;
    streamBuf = "";
    confirmedTexts = [];
    searching = false;
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
          webSearch: settings.get().chatWebSearch,
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

  /** 保存済みの会話を開く（sessionId も復元するので --resume で続きから話せる）。 */
  const openConversation = (c: ChatConversation) => {
    if (busy) stop();
    currentReqId++; // 旧プロセスの残イベントを捨てる
    streamEl = null;
    setBusy(false);
    convId = c.id;
    sessionId = c.sessionId;
    inflightText = "";
    targetTabId = null; // 提案の適用先は引き継がない（タブが変わっている可能性がある）
    history.splice(0, history.length, ...c.messages);
    messages.replaceChildren();
    for (const m of c.messages) {
      if (m.role === "user") renderUserMsg(m.text);
      else renderAssistantMsg(m.text);
    }
    clearBanner();
    scrollToBottom();
    const s = loadStore();
    saveStore({ ...s, activeId: c.id });
  };

  historyBtn.addEventListener("click", () => {
    const s = loadStore();
    const items: MenuItem[] = s.conversations.map((c) => ({
      type: "item" as const,
      label: `${c.title} — ${new Date(c.updatedAt).toLocaleString()}`,
      action: () => openConversation(c),
    }));
    if (items.length === 0) {
      items.push({
        type: "item",
        label: t("chat.historyEmpty"),
        action: () => {},
      });
    } else {
      items.push({ type: "separator" });
      items.push({
        type: "item",
        label: t("chat.historyClear"),
        action: () => saveStore({ activeId: null, conversations: [] }),
      });
    }
    const r = historyBtn.getBoundingClientRect();
    showContextMenu(r.left, r.bottom + 2, items);
  });

  sendBtn.addEventListener("click", () => {
    if (busy) stop();
    else void send();
  });

  newBtn.addEventListener("click", () => {
    if (busy) stop();
    sessionId = null;
    inflightText = "";
    targetTabId = null; // 会話を離れたのでタブの使用中扱いも解く
    currentReqId++; // 以降、旧プロセスの残イベントを捨てる
    streamEl = null;
    setBusy(false);
    messages.replaceChildren();
    clearBanner();
    // 現在の会話はストアに残し（履歴ボタンから再開できる）、空の新しい会話へ切り替える
    convId = crypto.randomUUID();
    history.length = 0;
    const s = loadStore();
    saveStore({ ...s, activeId: null });
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

  // ── 表示制御 ─────────────────────────────────────
  // 開閉はセッション内の状態のみ（起動時は常に非表示）。設定 chatEnabled が
  // オフなら開けない。プレゼン中は実効非表示にする（outline と同方針）。
  let panelVisible = false;

  const isPresentationActive = (): boolean => {
    const a = store.getActive();
    return a?.kind === "preview" && a.previewMode === "slideshow";
  };

  const applyVisibility = () => {
    const visible =
      panelVisible && settings.get().chatEnabled && !isPresentationActive();
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
  // 空タブ転用の抑止判定を登録: このタブ宛ての会話（実行中または履歴）が
  // パネルに残っている間は「起動直後の空タブ」として転用させない。
  // 「新しい会話」で履歴を消せば解除される。
  inUseCheck = (tabId) =>
    targetTabId === tabId && (busy || messages.childElementCount > 0);

  // 起動時は常に新しい会話で開始する（過去の会話は「履歴」ボタンから再開）。
  // ここでは旧形式（v1: 単一会話）の保存データの移行だけ行う。
  if (persistable) {
    try {
      const legacy = localStorage.getItem(LEGACY_KEY);
      if (legacy && !localStorage.getItem(STORE_KEY)) {
        const parsed = JSON.parse(legacy) as {
          sessionId?: unknown;
          messages?: unknown;
        };
        const msgs = (Array.isArray(parsed.messages) ? parsed.messages : [])
          .filter(
            (m): m is ChatHistoryMsg =>
              !!m &&
              typeof (m as ChatHistoryMsg).text === "string" &&
              ((m as ChatHistoryMsg).role === "user" ||
                (m as ChatHistoryMsg).role === "assistant"),
          );
        if (msgs.length > 0) {
          const conv: ChatConversation = {
            id: crypto.randomUUID(),
            title:
              (msgs.find((m) => m.role === "user")?.text ?? "").slice(0, 40) ||
              "…",
            sessionId:
              typeof parsed.sessionId === "string" && parsed.sessionId
                ? parsed.sessionId
                : null,
            messages: msgs,
            updatedAt: Date.now(),
          };
          saveStore({ activeId: conv.id, conversations: [conv] });
        }
        localStorage.removeItem(LEGACY_KEY);
      }
    } catch {
      /* 移行失敗は無視 */
    }
  }

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

  return {
    toggle: () => {
      if (!settings.get().chatEnabled) return; // 機能オフ時は開かない
      panelVisible = !panelVisible;
      applyVisibility();
      if (panelVisible) input.focus();
    },
    isVisible: () => panelVisible,
  };
}
