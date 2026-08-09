/**
 * キーボードマクロ（記録・再生・保存/読込）のコア。
 *
 * 方式: 正規化ステップ記録＋ハイブリッド再生。
 *  - 文字入力は beforeinput/compositionend の確定テキストとして記録する
 *    （IME変換中の keydown は無視し、確定文字列だけを残す）。
 *  - その他のキーは {key, ctrl, shift, alt} のキーステップとして記録する。
 *  - contenteditable は untrusted イベントで文字入力・カーソル移動をしないため、
 *    再生はエミュレート＋合成イベントのハイブリッドで行う（Task 2 で追加）。
 */

import { Selection, TextSelection } from "@milkdown/kit/prose/state";
import type { EditorView } from "@milkdown/kit/prose/view";
import {
  save as saveDialog,
  open as openDialog,
  message,
} from "@tauri-apps/plugin-dialog";
import { invoke } from "@tauri-apps/api/core";
import type { EditorHost } from "./editor";
import { store } from "./store";
import { showProgress } from "./progress";
import { t } from "./i18n";

export type MacroStep =
  | { type: "text"; text: string }
  | { type: "key"; key: string; ctrl?: boolean; shift?: boolean; alt?: boolean };

/** keydown 判定に必要な最小限のイベント形（テスト容易性のため KeyboardEvent に依存しない）。 */
export type KeyLike = {
  key: string;
  ctrlKey: boolean;
  shiftKey: boolean;
  altKey: boolean;
  metaKey: boolean;
  isComposing?: boolean;
};

const MODIFIER_KEYS = new Set([
  "Control", "Shift", "Alt", "Meta", "AltGraph", "CapsLock",
]);

/**
 * keydown をキーステップへ正規化する。記録対象外は null:
 *  - IME変換中 / 修飾キー単独 / マクロ操作キー自身（Shift+F1/F2）
 *  - 修飾なし（Shiftのみ含む）の印字キー（beforeinput の insertText で記録する）
 */
export function keyStepFromEvent(e: KeyLike): MacroStep | null {
  if (e.isComposing || e.key === "Process") return null;
  if (MODIFIER_KEYS.has(e.key)) return null;
  if (
    e.shiftKey && !e.ctrlKey && !e.altKey && !e.metaKey &&
    (e.key === "F1" || e.key === "F2")
  ) {
    return null;
  }
  // 印字キー判定はサロゲートペア（絵文字等）も1文字とみなす
  if (!e.ctrlKey && !e.altKey && !e.metaKey && [...e.key].length === 1) {
    return null;
  }
  return {
    type: "key",
    key: e.key,
    ctrl: e.ctrlKey || e.metaKey,
    shift: e.shiftKey,
    alt: e.altKey,
  };
}

/** 末尾がテキストステップなら連結、でなければ新規追加する（steps を破壊的に更新）。 */
export function appendTextStep(steps: MacroStep[], text: string): void {
  if (!text) return;
  const last = steps[steps.length - 1];
  if (last && last.type === "text") {
    last.text += text;
  } else {
    steps.push({ type: "text", text });
  }
}

export function serializeMacro(steps: MacroStep[]): string {
  return JSON.stringify(
    { app: "mdedit", type: "keyboard-macro", version: 1, steps },
    null,
    2,
  );
}

/** マクロJSONを検証してステップ配列を返す。形式不正は null。 */
export function parseMacro(json: string): MacroStep[] | null {
  try {
    const data: unknown = JSON.parse(json);
    if (typeof data !== "object" || data === null) return null;
    const d = data as Record<string, unknown>;
    if (d.app !== "mdedit" || d.type !== "keyboard-macro" || d.version !== 1) {
      return null;
    }
    if (!Array.isArray(d.steps)) return null;
    const steps: MacroStep[] = [];
    for (const raw of d.steps) {
      const s = raw as Record<string, unknown> | null;
      if (s?.type === "text" && typeof s.text === "string") {
        steps.push({ type: "text", text: s.text });
      } else if (s?.type === "key" && typeof s.key === "string") {
        steps.push({
          type: "key",
          key: s.key,
          ctrl: !!s.ctrl,
          shift: !!s.shift,
          alt: !!s.alt,
        });
      } else {
        return null;
      }
    }
    return steps;
  } catch {
    return null;
  }
}

// ─── 再生エンジン ───────────────────────────────────────
// ブラウザ標準動作のキー（文字・矢印・Home/End・Backspace/Delete）は
// untrusted イベントでは動かないため ProseMirror API でエミュレートする。
// それ以外（Enter・Tab・Ctrl+B 等）は合成 keydown を view.dom へ送出し、
// Milkdown キーマップ／shortcuts.ts にそのまま処理させる。

function clampPos(view: EditorView, pos: number): number {
  return Math.max(0, Math.min(pos, view.state.doc.content.size));
}

function dispatchSyntheticKey(
  view: EditorView,
  step: { key: string; ctrl?: boolean; shift?: boolean; alt?: boolean },
): boolean {
  const ev = new KeyboardEvent("keydown", {
    key: step.key,
    ctrlKey: !!step.ctrl,
    shiftKey: !!step.shift,
    altKey: !!step.alt,
    bubbles: true,
    cancelable: true,
  });
  view.dom.dispatchEvent(ev);
  return true; // キーマップに消費されなくても致命的ではないため成功扱い
}

/** ←→ を1文字移動/拡張。文書端で動けなければ false。 */
function moveHorizontal(view: EditorView, dir: 1 | -1, extend: boolean): boolean {
  const { state } = view;
  const sel = state.selection;
  // 選択ありで拡張なしは端に潰す（ネイティブ挙動に合わせる）
  if (!extend && !sel.empty) {
    const pos = dir < 0 ? sel.from : sel.to;
    view.dispatch(
      state.tr.setSelection(TextSelection.create(state.doc, pos)).scrollIntoView(),
    );
    return true;
  }
  const target = Selection.near(
    state.doc.resolve(clampPos(view, sel.head + dir)),
    dir,
  ).head;
  if (target === sel.head) return false;
  const next = extend
    ? TextSelection.create(state.doc, sel.anchor, target)
    : TextSelection.create(state.doc, target);
  view.dispatch(state.tr.setSelection(next).scrollIntoView());
  return true;
}

/** ↑↓ を座標ベースで視覚的に1行移動/拡張。移動できなければ false。 */
function moveVertical(view: EditorView, dir: 1 | -1, extend: boolean): boolean {
  const { state } = view;
  const sel = state.selection;
  const coords = view.coordsAtPos(sel.head);
  const lineH = Math.max(coords.bottom - coords.top, 8);
  // 段落間マージンを跨げるよう、少しずつ遠くを何度か探る
  for (const mul of [0.6, 1.4, 2.4, 4]) {
    const y = dir < 0 ? coords.top - lineH * mul : coords.bottom + lineH * mul;
    const found = view.posAtCoords({ left: coords.left, top: y });
    if (!found || found.pos === sel.head) continue;
    const fc = view.coordsAtPos(found.pos);
    // 反対方向へ飛んでいたら不採用（余白の当たり判定の揺れ対策）
    if (dir < 0 ? fc.top >= coords.top : fc.bottom <= coords.bottom) continue;
    const $found = state.doc.resolve(found.pos);
    const next = extend
      ? TextSelection.between(state.doc.resolve(sel.anchor), $found)
      : Selection.near($found, dir);
    view.dispatch(state.tr.setSelection(next).scrollIntoView());
    return true;
  }
  return false;
}

/** Home/End を視覚行の行頭/行末へ移動/拡張（取れなければ論理段落の先頭/末尾）。 */
function moveLineEdge(view: EditorView, dir: 1 | -1, extend: boolean): boolean {
  const { state } = view;
  const sel = state.selection;
  const coords = view.coordsAtPos(sel.head);
  const mid = (coords.top + coords.bottom) / 2;
  const rect = view.dom.getBoundingClientRect();
  const x = dir < 0 ? rect.left + 1 : rect.right - 1;
  const found = view.posAtCoords({ left: x, top: mid });
  let pos: number;
  if (found) {
    pos = found.pos;
  } else {
    const $head = state.doc.resolve(sel.head);
    pos = dir < 0 ? $head.start() : $head.end();
  }
  if (pos === sel.head) return true; // 既に行頭/行末なら no-op 成功
  const next = extend
    ? TextSelection.between(state.doc.resolve(sel.anchor), state.doc.resolve(pos))
    : Selection.near(state.doc.resolve(pos), dir);
  view.dispatch(state.tr.setSelection(next).scrollIntoView());
  return true;
}

/**
 * Backspace/Delete の1文字削除（サロゲートペアは2単位で削除）。
 * ブロック境界（段落先頭での Backspace 等）は false を返し、
 * 呼び出し側で合成イベント（既存キーマップの行結合）へフォールバックする。
 */
function deleteChar(view: EditorView, dir: 1 | -1): boolean {
  const { state } = view;
  const sel = state.selection;
  if (!sel.empty) {
    view.dispatch(state.tr.deleteSelection().scrollIntoView());
    return true;
  }
  const $head = state.doc.resolve(sel.head);
  if (dir < 0) {
    if ($head.parentOffset === 0) return false;
    const before = $head.parent.textBetween(
      Math.max(0, $head.parentOffset - 2),
      $head.parentOffset,
      undefined,
      "￼",
    );
    const size = /[\uD800-\uDBFF][\uDC00-\uDFFF]$/.test(before) ? 2 : 1;
    view.dispatch(state.tr.delete(sel.head - size, sel.head).scrollIntoView());
  } else {
    if ($head.parentOffset >= $head.parent.content.size) return false;
    const after = $head.parent.textBetween(
      $head.parentOffset,
      Math.min($head.parent.content.size, $head.parentOffset + 2),
      undefined,
      "￼",
    );
    const size = /^[\uD800-\uDBFF][\uDC00-\uDFFF]/.test(after) ? 2 : 1;
    view.dispatch(state.tr.delete(sel.head, sel.head + size).scrollIntoView());
  }
  return true;
}

/** 1ステップ実行。移動できない等で先へ進めないときは false。 */
function playStep(view: EditorView, step: MacroStep): boolean {
  if (step.type === "text") {
    view.dispatch(view.state.tr.insertText(step.text).scrollIntoView());
    return true;
  }
  const { key, ctrl, shift, alt } = step;
  if (!ctrl && !alt) {
    if (key === "ArrowLeft") return moveHorizontal(view, -1, !!shift);
    if (key === "ArrowRight") return moveHorizontal(view, 1, !!shift);
    if (key === "ArrowUp") return moveVertical(view, -1, !!shift);
    if (key === "ArrowDown") return moveVertical(view, 1, !!shift);
    if (key === "Home") return moveLineEdge(view, -1, !!shift);
    if (key === "End") return moveLineEdge(view, 1, !!shift);
    if (key === "Backspace" || key === "Delete") {
      if (deleteChar(view, key === "Backspace" ? -1 : 1)) return true;
      return dispatchSyntheticKey(view, step); // ブロック境界は行結合キーマップへ
    }
  }
  if (ctrl && !alt && (key === "Home" || key === "End")) {
    const { state } = view;
    // Shift併用時は文書先頭/末尾まで選択拡張する
    const edge = key === "Home"
      ? Selection.atStart(state.doc)
      : Selection.atEnd(state.doc);
    const next = shift
      ? TextSelection.between(
          state.doc.resolve(state.selection.anchor),
          state.doc.resolve(edge.head),
        )
      : edge;
    view.dispatch(state.tr.setSelection(next).scrollIntoView());
    return true;
  }
  return dispatchSyntheticKey(view, step);
}

// ─── コントローラ ───────────────────────────────────────

export type MacroController = {
  /** 記録の開始/停止をトグルする（Shift+F1）。 */
  toggleRecord(): void;
  /** 直近マクロを1回再生する（Shift+F2）。 */
  play(): void;
  /** 回数を入力させて連続再生する。 */
  playRepeat(): Promise<void>;
  /** マクロをJSONファイルへ保存する。 */
  saveToFile(): Promise<void>;
  /** JSONファイルからマクロを読み込む。 */
  loadFromFile(): Promise<void>;
  isRecording(): boolean;
  hasMacro(): boolean;
  /** 記録を開始できるか（WYSIWYGタブがアクティブ ∧ 再生中でない）。 */
  canRecord(): boolean;
  /** 再生できるか（マクロあり ∧ WYSIWYGタブ ∧ 記録中・再生中でない）。 */
  canPlay(): boolean;
  /** 記録/再生状態の変化を購読する（インジケータ用）。解除関数を返す。 */
  onStateChange(fn: () => void): () => void;
};

const MACRO_FILE_FILTERS = [{ name: "JSON", extensions: ["json"] }];

export function createMacroController(editor: EditorHost): MacroController {
  let steps: MacroStep[] = [];
  let recording: MacroStep[] | null = null;
  let recordingView: EditorView | null = null;
  let playing = false;
  let unsubStore: (() => void) | null = null;
  const stateListeners = new Set<() => void>();
  const notifyState = () => {
    for (const fn of stateListeners) fn();
  };

  const toast = (text: string) => {
    const p = showProgress(text);
    setTimeout(() => p.close(), 3000);
  };

  /** 記録対象のイベントか（記録中 ∧ 記録開始時のエディタ内が対象）。 */
  const recordTarget = (e: Event): boolean => {
    if (!recording || !recordingView) return false;
    // タブ切替・ソースモード切替等でアクティブviewが差し替わったら自動停止
    if (editor.getActiveView() !== recordingView) {
      stopRecord();
      return false;
    }
    const target = e.target as Node | null;
    return !!target && recordingView.dom.contains(target);
  };

  const onKeyDown = (e: KeyboardEvent) => {
    if (!recordTarget(e)) return;
    const step = keyStepFromEvent(e);
    if (step && recording) recording.push(step);
  };

  const onBeforeInput = (e: Event) => {
    if (!recordTarget(e)) return;
    const ie = e as InputEvent;
    if (ie.inputType === "insertText" && ie.data && recording) {
      appendTextStep(recording, ie.data);
    }
  };

  const onCompositionEnd = (e: Event) => {
    if (!recordTarget(e)) return;
    const ce = e as CompositionEvent;
    if (ce.data && recording) appendTextStep(recording, ce.data);
  };

  const startRecord = () => {
    const view = editor.getActiveView();
    if (!view || playing) return;
    recording = [];
    recordingView = view;
    window.addEventListener("keydown", onKeyDown, true);
    window.addEventListener("beforeinput", onBeforeInput, true);
    window.addEventListener("compositionend", onCompositionEnd, true);
    unsubStore = store.subscribe(() => {
      if (editor.getActiveView() !== recordingView) stopRecord();
    });
    notifyState();
  };

  const stopRecord = () => {
    if (!recording) return;
    // 空の記録は直近マクロを上書きしない（誤操作でマクロを失わないため）
    if (recording.length > 0) steps = recording;
    recording = null;
    recordingView = null;
    window.removeEventListener("keydown", onKeyDown, true);
    window.removeEventListener("beforeinput", onBeforeInput, true);
    window.removeEventListener("compositionend", onCompositionEnd, true);
    unsubStore?.();
    unsubStore = null;
    notifyState();
  };

  const playTimes = async (count: number): Promise<void> => {
    if (playing || recording || steps.length === 0) return;
    if (!editor.getActiveView()) return;
    playing = true;
    notifyState();
    try {
      for (let i = 0; i < count; i++) {
        // ステップがタブ切替等を起こした場合に備えて毎回取り直す
        const view = editor.getActiveView();
        if (!view) return;
        for (const step of steps) {
          if (!playStep(view, step)) {
            // 文書端などでこれ以上進めない: 残りを中断して通知
            toast(
              t("macro.aborted")
                .replace("{done}", String(i))
                .replace("{total}", String(count)),
            );
            return;
          }
        }
      }
    } finally {
      playing = false;
      notifyState();
    }
  };

  return {
    toggleRecord() {
      if (recording) stopRecord();
      else startRecord();
    },
    play() {
      void playTimes(1);
    },
    async playRepeat() {
      if (playing || recording || steps.length === 0) return;
      const raw = window.prompt(t("macro.repeatPrompt"), "10");
      if (raw === null) return;
      const n = Math.floor(Number(raw));
      if (!Number.isFinite(n) || n < 1 || n > 9999) {
        toast(t("macro.invalidCount"));
        return;
      }
      await playTimes(n);
    },
    async saveToFile() {
      if (steps.length === 0) return;
      const picked = await saveDialog({
        title: t("macro.saveTitle"),
        filters: MACRO_FILE_FILTERS,
        defaultPath: "macro.json",
      });
      if (!picked) return;
      await invoke<void>("write_file", {
        path: picked,
        content: serializeMacro(steps),
      });
    },
    async loadFromFile() {
      const picked = await openDialog({
        title: t("macro.loadTitle"),
        filters: MACRO_FILE_FILTERS,
        multiple: false,
      });
      if (typeof picked !== "string") return;
      const content = await invoke<string>("read_file", { path: picked });
      const parsed = parseMacro(content);
      if (!parsed) {
        void message(t("macro.invalidFile"), { kind: "error" });
        return;
      }
      steps = parsed;
      notifyState();
    },
    isRecording() {
      return recording !== null;
    },
    hasMacro() {
      return steps.length > 0;
    },
    canRecord() {
      return !playing && editor.getActiveView() !== null;
    },
    canPlay() {
      return (
        steps.length > 0 &&
        !playing &&
        recording === null &&
        editor.getActiveView() !== null
      );
    },
    onStateChange(fn: () => void) {
      stateListeners.add(fn);
      return () => stateListeners.delete(fn);
    },
  };
}
