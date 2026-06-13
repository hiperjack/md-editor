/**
 * 画面右下に出す簡易プログレストースト。
 * HTML出力・印刷時のMermaid変換（「図を変換中… 3/8」）等に使う。
 */

export type ProgressHandle = {
  update(text: string): void;
  close(): void;
};

export function showProgress(text: string): ProgressHandle {
  const el = document.createElement("div");
  el.className = "progress-toast";
  el.textContent = text;
  document.body.appendChild(el);
  let closed = false;
  return {
    update(next: string) {
      if (!closed) el.textContent = next;
    },
    close() {
      if (closed) return;
      closed = true;
      el.remove();
    },
  };
}
