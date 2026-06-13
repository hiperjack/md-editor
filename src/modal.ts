import { t } from "./i18n";

type ButtonKind = "primary" | "default" | "danger";

type ButtonSpec<T extends string> = {
  label: string;
  value: T;
  kind?: ButtonKind;
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

export type SaveChoice = "save" | "discard" | "cancel";

export function confirmSave(filename: string): Promise<SaveChoice> {
  return showModal<SaveChoice>({
    title: t("dlg.save.title"),
    body: t("dlg.save.body").replace("{filename}", filename),
    buttons: [
      { label: t("dlg.save.save"), value: "save", kind: "primary" },
      { label: t("dlg.save.discard"), value: "discard", kind: "danger" },
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
      { label: t("dlg.closeAll.review"), value: "review", kind: "primary" },
      { label: t("dlg.closeAll.discard"), value: "discard", kind: "danger" },
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
