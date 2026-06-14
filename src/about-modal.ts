import { invoke } from "@tauri-apps/api/core";
import { getVersion } from "@tauri-apps/api/app";
import { t } from "./i18n";

const REPO_URL = "https://github.com/hiperjack/md-editor";

function isTauriContext(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

function openRepo(): void {
  if (isTauriContext()) {
    void invoke("open_external_url", { url: REPO_URL }).catch((e) =>
      console.warn("open_external_url failed:", e),
    );
  } else {
    window.open(REPO_URL, "_blank", "noopener,noreferrer");
  }
}

/** ヘルプ→「mdeditについて」。バージョンとクリック可能なGitHubリンクを表示する。 */
export async function openAboutModal(): Promise<void> {
  const root = document.getElementById("modal-root");
  if (!root) return;
  // 二重に開かない。
  if (root.querySelector(".about-dialog")) return;

  let version = "";
  try {
    version = await getVersion();
  } catch {
    // 非Tauri環境では取得できない。
  }

  const overlay = document.createElement("div");
  overlay.className = "modal-overlay";

  const dialog = document.createElement("div");
  dialog.className = "modal-dialog about-dialog";
  dialog.setAttribute("role", "dialog");
  dialog.setAttribute("aria-modal", "true");

  const titleEl = document.createElement("div");
  titleEl.className = "modal-title";
  titleEl.textContent = "mdedit";

  const bodyEl = document.createElement("div");
  bodyEl.className = "modal-body about-body";

  if (version) {
    const verEl = document.createElement("div");
    verEl.className = "about-version";
    verEl.textContent = `${t("about.version")} ${version}`;
    bodyEl.appendChild(verEl);
  }

  // href を付けない span 風リンク。OS既定ブラウザで開く（webview遷移を避ける）。
  const linkEl = document.createElement("a");
  linkEl.className = "about-link";
  linkEl.setAttribute("role", "link");
  linkEl.tabIndex = 0;
  linkEl.textContent = `GitHub: ${REPO_URL}`;
  linkEl.addEventListener("click", (e) => {
    e.preventDefault();
    e.stopPropagation();
    openRepo();
  });
  linkEl.addEventListener("keydown", (e) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      openRepo();
    }
  });
  bodyEl.appendChild(linkEl);

  const btnRow = document.createElement("div");
  btnRow.className = "modal-buttons";
  const okBtn = document.createElement("button");
  okBtn.className = "modal-btn modal-btn-primary";
  okBtn.textContent = t("about.close");
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

  dialog.appendChild(titleEl);
  dialog.appendChild(bodyEl);
  dialog.appendChild(btnRow);
  overlay.appendChild(dialog);
  root.appendChild(overlay);

  okBtn.focus();
}
