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
