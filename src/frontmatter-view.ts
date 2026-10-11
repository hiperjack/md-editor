/**
 * frontmatter ノードの NodeView。Obsidian の「プロパティ」に似たキー・値の表を描き、
 * その場で編集できるようにする。
 *
 * 編集はすべて「新しい YAML 文字列を計算 → setNodeMarkup で value 属性を差し替える」
 * トランザクションとして dispatch するので、Ctrl+Z で戻せる。入力中は dispatch せず、
 * blur / Enter で確定する（確定のたびに再描画されるため、入力途中で描き直さない）。
 */
import type { Node as ProseNode } from "@milkdown/kit/prose/model";
import type { EditorView, NodeView } from "@milkdown/kit/prose/view";
import { t } from "./i18n";
import {
  addFrontmatterKey,
  deleteFrontmatterKey,
  parseFrontmatterRows,
  renameFrontmatterKey,
  setFrontmatterValue,
  type FrontmatterRow,
} from "./frontmatter";

type Col = "key" | "value";
type Focus = { row: number; col: Col } | null;

export class FrontmatterNodeView implements NodeView {
  dom: HTMLElement;
  private node: ProseNode;
  private view: EditorView;
  private getPos: () => number | undefined;
  private collapsed = false;
  /** 「追加」で作った、まだ YAML に無い行を編集中か。 */
  private pendingNewRow = false;
  private pendingFocus: Focus = null;

  constructor(
    node: ProseNode,
    view: EditorView,
    getPos: () => number | undefined,
  ) {
    this.node = node;
    this.view = view;
    this.getPos = getPos;
    this.dom = document.createElement("div");
    this.dom.className = "frontmatter-block";
    this.dom.setAttribute("data-type", "frontmatter");
    this.dom.contentEditable = "false";
    this.render();
  }

  private get value(): string {
    return (this.node.attrs.value as string) ?? "";
  }

  update(node: ProseNode): boolean {
    if (node.type !== this.node.type) return false;
    const changed = node.attrs.value !== this.node.attrs.value;
    this.node = node;
    if (changed) this.render();
    return true;
  }

  /** 表の入力・ボタン・ヘッダー上のイベントは ProseMirror に渡さない。 */
  stopEvent(event: Event): boolean {
    const target = event.target as HTMLElement | null;
    if (!target) return false;
    return !!target.closest("input, textarea, button, .frontmatter-header");
  }

  ignoreMutation(): boolean {
    return true;
  }

  selectNode(): void {
    this.dom.classList.add("ProseMirror-selectednode");
  }

  deselectNode(): void {
    this.dom.classList.remove("ProseMirror-selectednode");
  }

  /** 新しい YAML を属性に書き込む。変化が無ければ表示だけ元に戻す。 */
  private commit(next: string): void {
    if (next === this.value) {
      this.render();
      return;
    }
    const pos = this.getPos();
    if (pos === undefined) return;
    const tr = this.view.state.tr.setNodeMarkup(pos, undefined, {
      ...this.node.attrs,
      value: next,
    });
    this.view.dispatch(tr);
  }

  private render(): void {
    this.dom.replaceChildren();
    this.dom.setAttribute("data-value", this.value);
    const { rows, error } = parseFrontmatterRows(this.value);

    const header = document.createElement("div");
    header.className = "frontmatter-header";
    header.setAttribute("role", "button");
    header.title = t("frontmatter.toggle");
    const caret = document.createElement("span");
    caret.className = "frontmatter-caret";
    caret.textContent = this.collapsed ? "▸" : "▾";
    const title = document.createElement("span");
    title.className = "frontmatter-title";
    title.textContent = t("frontmatter.title");
    const count = document.createElement("span");
    count.className = "frontmatter-count";
    count.textContent = error ? "!" : String(rows.length);
    header.append(caret, title, count);
    header.addEventListener("mousedown", (e) => e.preventDefault());
    header.addEventListener("click", () => {
      this.collapsed = !this.collapsed;
      this.render();
    });
    this.dom.appendChild(header);
    this.dom.classList.toggle("is-collapsed", this.collapsed);
    if (this.collapsed) return;

    const body = document.createElement("div");
    body.className = "frontmatter-body";
    this.dom.appendChild(body);

    if (error) {
      // YAML として読めないときは原文をそのまま編集させ、内容を失わせない。
      const warn = document.createElement("div");
      warn.className = "frontmatter-warning";
      warn.textContent = t("frontmatter.invalid");
      const ta = document.createElement("textarea");
      ta.className = "frontmatter-raw";
      ta.value = this.value;
      ta.rows = Math.max(3, this.value.split("\n").length);
      ta.spellcheck = false;
      ta.addEventListener("blur", () => this.commit(ta.value));
      ta.addEventListener("keydown", (e) => e.stopPropagation());
      body.append(warn, ta);
      return;
    }

    const table = document.createElement("table");
    table.className = "frontmatter-table";
    const tbody = document.createElement("tbody");
    table.appendChild(tbody);
    rows.forEach((row, i) => tbody.appendChild(this.renderRow(row, i)));
    if (this.pendingNewRow) {
      tbody.appendChild(
        this.renderRow({ key: "", value: "", kind: "scalar" }, rows.length, true),
      );
    }
    body.appendChild(table);

    const add = document.createElement("button");
    add.type = "button";
    add.className = "frontmatter-add";
    add.textContent = t("frontmatter.add");
    add.addEventListener("mousedown", (e) => e.preventDefault());
    add.addEventListener("click", () => {
      this.pendingNewRow = true;
      this.pendingFocus = { row: rows.length, col: "key" };
      this.render();
    });
    body.appendChild(add);

    this.applyPendingFocus();
  }

  private renderRow(
    row: FrontmatterRow,
    index: number,
    isNew = false,
  ): HTMLTableRowElement {
    const tr = document.createElement("tr");
    tr.dataset.row = String(index);

    const keyCell = document.createElement("th");
    const keyInput = document.createElement("input");
    keyInput.type = "text";
    keyInput.className = "frontmatter-key";
    keyInput.value = row.key;
    keyInput.placeholder = t("frontmatter.keyPlaceholder");
    keyInput.spellcheck = false;
    keyInput.dataset.col = "key";
    keyCell.appendChild(keyInput);

    const valueCell = document.createElement("td");
    const valueInput = document.createElement("input");
    valueInput.type = "text";
    valueInput.className = `frontmatter-value frontmatter-value-${row.kind}`;
    valueInput.value = row.value;
    valueInput.placeholder = t("frontmatter.valuePlaceholder");
    valueInput.spellcheck = false;
    valueInput.dataset.col = "value";
    if (row.kind === "list") valueInput.title = t("frontmatter.listHint");
    if (row.kind === "complex") valueInput.title = t("frontmatter.complexHint");
    valueCell.appendChild(valueInput);

    const actionCell = document.createElement("td");
    actionCell.className = "frontmatter-actions";
    const del = document.createElement("button");
    del.type = "button";
    del.className = "frontmatter-delete";
    del.title = t("frontmatter.delete");
    del.textContent = "×";
    del.addEventListener("mousedown", (e) => e.preventDefault());
    del.addEventListener("click", () => {
      if (isNew) {
        this.pendingNewRow = false;
        this.render();
        return;
      }
      this.commit(deleteFrontmatterKey(this.value, row.key));
    });
    actionCell.appendChild(del);

    tr.append(keyCell, valueCell, actionCell);

    const commitKey = () => {
      const name = keyInput.value.trim();
      if (isNew) {
        this.pendingNewRow = false;
        if (name === "") {
          this.render();
          return;
        }
        this.pendingFocus = { row: index, col: "value" };
        this.commit(addFrontmatterKey(this.value, name));
        return;
      }
      this.commit(renameFrontmatterKey(this.value, row.key, name));
    };
    const commitValue = () => {
      if (isNew) return; // キー確定前の新規行は値を持たない
      this.commit(setFrontmatterValue(this.value, row.key, valueInput.value));
    };

    keyInput.addEventListener("blur", commitKey);
    valueInput.addEventListener("blur", commitValue);

    const onKey = (input: HTMLInputElement, col: Col) => (e: KeyboardEvent) => {
      if (e.key === "Enter") {
        e.preventDefault();
        // Enter は確定して次の欄（キー → 値 → 次の行のキー）へ進む。
        this.pendingFocus =
          col === "key"
            ? { row: index, col: "value" }
            : { row: index + 1, col: "key" };
        input.blur();
      } else if (e.key === "Escape") {
        e.preventDefault();
        input.value = col === "key" ? row.key : row.value;
        input.blur();
        this.view.focus();
      }
      e.stopPropagation();
    };
    keyInput.addEventListener("keydown", onKey(keyInput, "key"));
    valueInput.addEventListener("keydown", onKey(valueInput, "value"));
    return tr;
  }

  private applyPendingFocus(): void {
    const f = this.pendingFocus;
    this.pendingFocus = null;
    if (!f) return;
    const input = this.dom.querySelector<HTMLInputElement>(
      `tr[data-row="${f.row}"] input[data-col="${f.col}"]`,
    );
    if (input) {
      input.focus();
      input.select();
    }
  }

  destroy(): void {
    this.dom.replaceChildren();
  }
}
