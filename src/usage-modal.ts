/**
 * ヘルプ→「Claude使用量」のモーダル。
 * 5h/7dの使用率・リセット時刻とモデル別週次上限をリング表示する。
 * 開くたびに強制再取得（fetchUsage(true)）。失敗時は文言＋再試行ボタン。
 */
import { t } from "./i18n";
import {
  fetchUsage,
  ringChar,
  ringColor,
  fmtReset,
  usageErrorKey,
  type UsageData,
} from "./usage";

export async function openUsageModal(): Promise<void> {
  const root = document.getElementById("modal-root");
  if (!root) return;
  // 二重に開かない。
  if (root.querySelector(".usage-dialog")) return;

  const overlay = document.createElement("div");
  overlay.className = "modal-overlay";

  const dialog = document.createElement("div");
  dialog.className = "modal-dialog usage-dialog";
  dialog.setAttribute("role", "dialog");
  dialog.setAttribute("aria-modal", "true");

  const titleEl = document.createElement("div");
  titleEl.className = "modal-title";
  titleEl.textContent = t("usage.title");

  const bodyEl = document.createElement("div");
  bodyEl.className = "modal-body usage-body";

  const btnRow = document.createElement("div");
  btnRow.className = "modal-buttons";
  const okBtn = document.createElement("button");
  okBtn.className = "modal-btn modal-btn-primary";
  okBtn.textContent = t("usage.close");
  btnRow.appendChild(okBtn);

  const close = () => {
    document.removeEventListener("keydown", onKey, true);
    overlay.remove();
  };
  const onKey = (e: KeyboardEvent) => {
    if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      close();
    }
  };

  okBtn.addEventListener("click", close);
  overlay.addEventListener("mousedown", (e) => {
    if (e.target === overlay) close();
  });
  document.addEventListener("keydown", onKey, true);

  const row = (label: string, percent: number, resetsAt: string | null) => {
    const el = document.createElement("div");
    el.className = "usage-row";
    const name = document.createElement("span");
    name.className = "usage-label";
    name.textContent = label;
    const ring = document.createElement("span");
    ring.className = "usage-ring";
    ring.textContent = ringChar(percent);
    ring.style.color = ringColor(percent);
    const pct = document.createElement("span");
    pct.className = "usage-pct";
    pct.textContent = `${Math.round(percent)}%`;
    const reset = document.createElement("span");
    reset.className = "usage-reset";
    const r = fmtReset(resetsAt);
    reset.textContent = r ? t("usage.resets").replace("{time}", r) : "";
    el.append(name, ring, pct, reset);
    return el;
  };

  const showError = (key: "usage.errAuth" | "usage.errFetch") => {
    bodyEl.replaceChildren();
    const msg = document.createElement("div");
    msg.className = "usage-error";
    msg.textContent = t(key);
    const retry = document.createElement("button");
    retry.className = "modal-btn";
    retry.textContent = t("usage.retry");
    retry.addEventListener("click", () => void load());
    bodyEl.append(msg, retry);
  };

  const render = (d: UsageData) => {
    bodyEl.replaceChildren();
    if (d.fiveHour)
      bodyEl.appendChild(
        row(t("usage.fiveHour"), d.fiveHour.utilization, d.fiveHour.resetsAt),
      );
    if (d.sevenDay)
      bodyEl.appendChild(
        row(t("usage.sevenDay"), d.sevenDay.utilization, d.sevenDay.resetsAt),
      );
    for (const s of d.scoped)
      bodyEl.appendChild(row(s.label, s.percent, s.resetsAt));
    // 全フィールド欠落（スキーマ激変）も取得失敗として扱う
    if (!bodyEl.childElementCount) showError("usage.errFetch");
  };

  const load = async () => {
    bodyEl.replaceChildren();
    const loading = document.createElement("div");
    loading.className = "usage-error";
    loading.textContent = t("usage.loading");
    bodyEl.appendChild(loading);
    try {
      render(await fetchUsage(true));
    } catch (e) {
      showError(usageErrorKey(e));
    }
  };

  dialog.appendChild(titleEl);
  dialog.appendChild(bodyEl);
  dialog.appendChild(btnRow);
  overlay.appendChild(dialog);
  root.appendChild(overlay);

  okBtn.focus();
  void load();
}
