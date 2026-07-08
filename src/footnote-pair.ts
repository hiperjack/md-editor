/**
 * 脚注ペアのリアルタイム着色（ProseMirror デコレーション）。
 *
 * 脚注はノード化せず常にテキストとして扱う（remark-footnote-text.ts がパース時に
 * 展開する）。本モジュールは doc 変更のたびに参照/定義ラベルを収集してペア判定し、
 * ペア成立したトークンへ .fn-pair（参照は .fn-pair-ref で右肩表示）を付けて
 * 青くする。未ペアのトークンは無装飾（通常の黒テキスト）のまま。
 * 文書を書き換えるのは、貼り付け等で紛れ込んだ脚注ノードをテキストへ展開する
 * 安全網（appendTransaction）だけで、それ以外は表示のみ（undo・カーソル・
 * Markdown原文に影響なし）。
 *
 * 既知の限界: ソース上の \[^1] は remark がパース時にバックスラッシュを消費する
 * ため、ファイルを開いた後の doc 上では素の [^1] と区別できず青くなり得る
 * （エスケープ判定が効くのは WYSIWYG 上で直接入力されたバックスラッシュのみ）。
 */

import { Plugin, PluginKey } from "@milkdown/kit/prose/state";
import type { EditorState, Transaction } from "@milkdown/kit/prose/state";
import type { Node as ProseNode } from "@milkdown/kit/prose/model";
import { Decoration, DecorationSet } from "@milkdown/kit/prose/view";

export type FnTokenKind = "ref" | "def";

export interface FnToken {
  kind: FnTokenKind;
  label: string;
  /** テキスト内オフセット。def の to は末尾の ':' を含む。 */
  from: number;
  to: number;
}

const TOKEN_RE = /\[\^([^\]\s]+)\]/g;

/** 直前の連続バックスラッシュが奇数個ならエスケープされている。 */
function isEscaped(text: string, index: number): boolean {
  let n = 0;
  for (let i = index - 1; i >= 0 && text[i] === "\\"; i--) n++;
  return n % 2 === 1;
}

/**
 * 段落1つ分のテキストから脚注トークンを走査する。
 * text は「テキストそのまま・hardbreak は \n・その他インライン要素と
 * インラインコードは半角スペース埋め」の文字列（オフセット＝doc相対位置）。
 * 行頭（先頭または \n 直後）かつ直後に ':' が続くものは定義、他は参照。
 */
export function scanFootnoteTokens(text: string): FnToken[] {
  const out: FnToken[] = [];
  TOKEN_RE.lastIndex = 0;
  for (let m = TOKEN_RE.exec(text); m; m = TOKEN_RE.exec(text)) {
    if (isEscaped(text, m.index)) continue;
    const label = m[1];
    const atLineStart = m.index === 0 || text[m.index - 1] === "\n";
    const end = m.index + m[0].length;
    if (atLineStart && text[end] === ":") {
      out.push({ kind: "def", label, from: m.index, to: end + 1 });
    } else {
      out.push({ kind: "ref", label, from: m.index, to: end });
    }
  }
  return out;
}

interface TextToken {
  token: FnToken;
  /** textblock コンテンツ開始の doc 位置。 */
  base: number;
}

function collect(doc: ProseNode): TextToken[] {
  const out: TextToken[] = [];
  doc.descendants((node, pos) => {
    if (node.type.name === "code_block") return false;
    if (node.isTextblock) {
      let text = "";
      node.forEach((child) => {
        if (child.type.name === "hardbreak") {
          text += "\n";
        } else if (child.isText && child.text) {
          const isCode = child.marks.some((mk) => mk.type.name === "inlineCode");
          text += isCode ? " ".repeat(child.text.length) : child.text;
        } else {
          text += " ".repeat(child.nodeSize);
        }
      });
      const base = pos + 1;
      for (const token of scanFootnoteTokens(text)) {
        out.push({ token, base });
      }
      return false; // インラインは処理済み
    }
    return true;
  });
  return out;
}

function buildDecorations(doc: ProseNode): DecorationSet {
  const textTokens = collect(doc);
  const refLabels = new Set<string>();
  const defLabels = new Set<string>();
  for (const { token } of textTokens) {
    (token.kind === "ref" ? refLabels : defLabels).add(token.label);
  }

  const decos: Decoration[] = [];
  for (const { token, base } of textTokens) {
    if (!refLabels.has(token.label) || !defLabels.has(token.label)) continue;
    decos.push(
      Decoration.inline(base + token.from, base + token.to, {
        class:
          token.kind === "ref" ? "fn-pair fn-pair-ref" : "fn-pair fn-pair-def",
        "data-fn-label": token.label,
      }),
    );
  }
  return decos.length > 0 ? DecorationSet.create(doc, decos) : DecorationSet.empty;
}

/**
 * 貼り付け等、remark を通らない経路で紛れ込んだ脚注ノードをテキスト表現へ
 * 展開する（通常運用では発火しない）。定義はテキストブロックの子だけを
 * hardbreak 結合で残す（段落以外の子は貼り付け安全網では扱わない）。
 */
function denodeize(state: EditorState): Transaction | null {
  const targets: { pos: number; node: ProseNode }[] = [];
  state.doc.descendants((node, pos) => {
    const name = node.type.name;
    if (name === "footnote_reference" || name === "footnote_definition") {
      targets.push({ pos, node });
      return false;
    }
    return true;
  });
  if (targets.length === 0) return null;
  const tr = state.tr;
  // 位置ずれを避けるため後ろから置換する。
  for (const { pos, node } of targets.reverse()) {
    const label = String(node.attrs.label ?? "");
    if (node.type.name === "footnote_reference") {
      tr.replaceWith(pos, pos + node.nodeSize, state.schema.text(`[^${label}]`));
      continue;
    }
    // 異常な貼り付け内容で createChecked が投げると dispatch ごと失敗して
    // エディタが固まるため、変換できない定義はスキップする（元ノードのまま残す）。
    try {
      const inline: ProseNode[] = [state.schema.text(`[^${label}]: `)];
      const hardbreak = state.schema.nodes.hardbreak;
      let first = true;
      node.forEach((child) => {
        if (!child.isTextblock) return;
        if (!first && hardbreak) inline.push(hardbreak.create());
        first = false;
        child.forEach((n) => {
          if (n.type.name === "footnote_reference") {
            inline.push(state.schema.text(`[^${String(n.attrs.label ?? "")}]`));
          } else {
            inline.push(n);
          }
        });
      });
      tr.replaceWith(
        pos,
        pos + node.nodeSize,
        state.schema.nodes.paragraph.createChecked(null, inline),
      );
    } catch (e) {
      console.warn("footnote denodeize failed:", e);
    }
  }
  return tr;
}

const footnotePairKey = new PluginKey<DecorationSet>("md-editor-footnote-pair");

export const footnotePairPlugin = new Plugin<DecorationSet>({
  key: footnotePairKey,
  state: {
    init(_config, state) {
      return buildDecorations(state.doc);
    },
    apply(tr, value) {
      return tr.docChanged ? buildDecorations(tr.doc) : value;
    },
  },
  appendTransaction(transactions, _oldState, newState) {
    if (!transactions.some((tr) => tr.docChanged)) return null;
    return denodeize(newState);
  },
  props: {
    decorations(state) {
      return footnotePairKey.getState(state) ?? null;
    },
  },
});
