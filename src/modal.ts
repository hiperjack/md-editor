import { t } from "./i18n";

type ButtonKind = "primary" | "default" | "danger";

type ButtonSpec<T extends string> = {
  label: string;
  value: T;
  kind?: ButtonKind;
  /** Alt+<英字> でこのボタンを選択できるようにする（小文字1文字で指定）。 */
  altKey?: string;
};

function showModal<T extends string>(opts: {
  title: string;
  body: string;
  buttons: ButtonSpec<T>[];
  defaultValue: T;
}): Promise<T> {
  return new Promise((resolve) => {
    const root = document.getElementById("modal-root");
    if (!root) {
      resolve(opts.defaultValue);
      return;
    }

    const overlay = document.createElement("div");
    overlay.className = "modal-overlay";

    const dialog = document.createElement("div");
    dialog.className = "modal-dialog";
    dialog.setAttribute("role", "dialog");
    dialog.setAttribute("aria-modal", "true");

    const titleEl = document.createElement("div");
    titleEl.className = "modal-title";
    titleEl.textContent = opts.title;

    const bodyEl = document.createElement("div");
    bodyEl.className = "modal-body";
    bodyEl.textContent = opts.body;

    const btnRow = document.createElement("div");
    btnRow.className = "modal-buttons";

    let resolved = false;
    const finish = (value: T) => {
      if (resolved) return;
      resolved = true;
      document.removeEventListener("keydown", onKey, true);
      overlay.remove();
      resolve(value);
    };

    const onKey = (e: KeyboardEvent) => {
      // Alt+英字: altKey が一致するボタンで確定（例: Alt+Y=保存 / Alt+N=破棄）。
      // AltGr(=Ctrl+Alt) や Meta 併用は対象外（非Latin配列での誤発火を防ぐ）。
      if (e.altKey && !e.ctrlKey && !e.metaKey) {
        const hit = opts.buttons.find(
          (b) => b.altKey && b.altKey === e.key.toLowerCase(),
        );
        if (hit) {
          e.preventDefault();
          e.stopPropagation();
          finish(hit.value);
          return;
        }
      }
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        finish(opts.defaultValue);
      } else if (e.key === "Enter") {
        const primary = opts.buttons.find((b) => b.kind === "primary");
        if (primary) {
          e.preventDefault();
          e.stopPropagation();
          finish(primary.value);
        }
      }
    };

    for (const spec of opts.buttons) {
      const btn = document.createElement("button");
      btn.className = `modal-btn modal-btn-${spec.kind ?? "default"}`;
      btn.textContent = spec.label;
      btn.addEventListener("click", () => finish(spec.value));
      btnRow.appendChild(btn);
    }

    dialog.appendChild(titleEl);
    dialog.appendChild(bodyEl);
    dialog.appendChild(btnRow);
    overlay.appendChild(dialog);
    root.appendChild(overlay);

    document.addEventListener("keydown", onKey, true);

    const primaryBtn = btnRow.querySelector<HTMLButtonElement>(
      ".modal-btn-primary",
    );
    (primaryBtn ?? btnRow.querySelector("button"))?.focus();
  });
}

export type PromptField = {
  /** 入力欄の上に出す説明。 */
  label: string;
  /** 初期値。 */
  value?: string;
  placeholder?: string;
  /** 数値入力向けのキーボード指定（見た目は通常の入力欄）。 */
  numeric?: boolean;
};

/**
 * タイトル付きの入力ダイアログ。window.prompt の置き換え。
 *
 * window.prompt は WebView2 がタイトルを「tauri.localhost の内容」に固定し、
 * 何のダイアログか分からないため使わない。複数の入力欄を 1 枚にまとめられる。
 * OK / Enter で各欄の値を配列で返し、キャンセル / Esc なら null を返す。
 * IME 変換確定の Enter では確定しない。
 */
export function promptFields(opts: {
  title: string;
  fields: PromptField[];
  okLabel?: string;
}): Promise<string[] | null> {
  return new Promise((resolve) => {
    const root = document.getElementById("modal-root");
    if (!root) {
      resolve(null);
      return;
    }

    const overlay = document.createElement("div");
    overlay.className = "modal-overlay";

    const dialog = document.createElement("div");
    dialog.className = "modal-dialog modal-prompt";
    dialog.setAttribute("role", "dialog");
    dialog.setAttribute("aria-modal", "true");

    const titleEl = document.createElement("div");
    titleEl.className = "modal-title";
    titleEl.textContent = opts.title;
    dialog.appendChild(titleEl);

    const bodyEl = document.createElement("div");
    bodyEl.className = "modal-body";
    const inputs = opts.fields.map((f, i) => {
      const row = document.createElement("label");
      row.className = "modal-field";
      const cap = document.createElement("span");
      cap.className = "modal-field-label";
      cap.textContent = f.label;
      const input = document.createElement("input");
      input.type = "text";
      input.className = "modal-input";
      input.value = f.value ?? "";
      if (f.placeholder) input.placeholder = f.placeholder;
      if (f.numeric) input.inputMode = "numeric";
      input.spellcheck = false;
      input.autocomplete = "off";
      input.dataset.index = String(i);
      row.appendChild(cap);
      row.appendChild(input);
      bodyEl.appendChild(row);
      return input;
    });
    dialog.appendChild(bodyEl);

    const btnRow = document.createElement("div");
    btnRow.className = "modal-buttons";
    const okBtn = document.createElement("button");
    okBtn.className = "modal-btn modal-btn-primary";
    okBtn.textContent = opts.okLabel ?? t("dlg.ok");
    const cancelBtn = document.createElement("button");
    cancelBtn.className = "modal-btn modal-btn-default";
    cancelBtn.textContent = t("dlg.cancel");
    btnRow.appendChild(okBtn);
    btnRow.appendChild(cancelBtn);
    dialog.appendChild(btnRow);

    let resolved = false;
    const finish = (ok: boolean) => {
      if (resolved) return;
      resolved = true;
      document.removeEventListener("keydown", onKey, true);
      overlay.remove();
      resolve(ok ? inputs.map((el) => el.value) : null);
    };

    const onKey = (e: KeyboardEvent) => {
      if (e.isComposing || e.keyCode === 229) return;
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopImmediatePropagation();
        finish(false);
      } else if (e.key === "Enter") {
        // ボタンにフォーカスがあるときはそのボタンの既定動作（click）に任せる
        if (document.activeElement === cancelBtn) return;
        e.preventDefault();
        e.stopImmediatePropagation();
        finish(true);
      }
    };

    okBtn.addEventListener("click", () => finish(true));
    cancelBtn.addEventListener("click", () => finish(false));
    overlay.addEventListener("mousedown", (e) => {
      if (e.target === overlay) e.preventDefault();
    });

    overlay.appendChild(dialog);
    root.appendChild(overlay);
    document.addEventListener("keydown", onKey, true);

    const focusFirst = () => {
      if (resolved) return;
      const first = inputs[0];
      if (first) {
        first.focus();
        first.select();
      } else {
        okBtn.focus();
      }
    };
    focusFirst();
    // 呼び出し元（ツールバーの runOnActive や画像ダブルクリック）が同期的に本文へ
    // フォーカスを戻すため、次フレームでもう一度入力欄へフォーカスする。
    requestAnimationFrame(() => {
      if (!dialog.contains(document.activeElement)) focusFirst();
    });
  });
}

export type SaveChoice = "save" | "discard" | "cancel";

export function confirmSave(filename: string): Promise<SaveChoice> {
  return showModal<SaveChoice>({
    title: t("dlg.save.title"),
    body: t("dlg.save.body").replace("{filename}", filename),
    buttons: [
      { label: t("dlg.save.save"), value: "save", kind: "primary", altKey: "y" },
      { label: t("dlg.save.discard"), value: "discard", kind: "danger", altKey: "n" },
      { label: t("dlg.save.cancel"), value: "cancel" },
    ],
    defaultValue: "cancel",
  });
}

export type DuplicateChoice = "switch" | "reload" | "cancel";

export function confirmDuplicate(filename: string): Promise<DuplicateChoice> {
  return showModal<DuplicateChoice>({
    title: t("dlg.dup.title"),
    body: t("dlg.dup.body").replace("{filename}", filename),
    buttons: [
      { label: t("dlg.dup.switch"), value: "switch", kind: "primary" },
      { label: t("dlg.dup.reload"), value: "reload", kind: "danger" },
      { label: t("dlg.dup.cancel"), value: "cancel" },
    ],
    defaultValue: "cancel",
  });
}

export type DuplicateWindowChoice = "switch" | "open" | "cancel";

/** 別ウィンドウで既に開いているファイルを開こうとしたときの確認。 */
export function confirmDuplicateWindow(
  filename: string,
): Promise<DuplicateWindowChoice> {
  return showModal<DuplicateWindowChoice>({
    title: t("dlg.dupwin.title"),
    body: t("dlg.dupwin.body").replace("{filename}", filename),
    buttons: [
      { label: t("dlg.dupwin.switch"), value: "switch", kind: "primary" },
      { label: t("dlg.dupwin.open"), value: "open" },
      { label: t("dlg.dupwin.cancel"), value: "cancel" },
    ],
    defaultValue: "cancel",
  });
}

export type CloseAllChoice = "discard" | "cancel" | "review";

export function confirmCloseAll(): Promise<CloseAllChoice> {
  return showModal<CloseAllChoice>({
    title: t("dlg.closeAll.title"),
    body: t("dlg.closeAll.body"),
    buttons: [
      { label: t("dlg.closeAll.review"), value: "review", kind: "primary", altKey: "y" },
      { label: t("dlg.closeAll.discard"), value: "discard", kind: "danger", altKey: "n" },
      { label: t("dlg.closeAll.cancel"), value: "cancel" },
    ],
    defaultValue: "cancel",
  });
}

export type PrintOrientationChoice = "portrait" | "landscape" | "cancel";

/** 印刷（PDF出力）前に用紙の向きを尋ねる。 */
export function askPrintOrientation(): Promise<PrintOrientationChoice> {
  return showModal<PrintOrientationChoice>({
    title: t("dlg.print.title"),
    body: t("dlg.print.body"),
    buttons: [
      { label: t("dlg.print.portrait"), value: "portrait", kind: "primary" },
      { label: t("dlg.print.landscape"), value: "landscape" },
      { label: t("dlg.print.cancel"), value: "cancel" },
    ],
    defaultValue: "cancel",
  });
}
