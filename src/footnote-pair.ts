/**
 * 脚注ペアのリアルタイム着色（ProseMirror デコレーション）。
 *
 * WYSIWYG 上で手入力した [^1] / 行頭 [^1]: は remark 再パースまでただの
 * テキストで、既定では青色（脚注ノードのCSS）にならない。本モジュールは
 * doc 変更のたびに参照/定義ラベルを収集してペア判定し、
 *  - ペア成立したテキスト状態のトークンへ .fn-pair を付けて青くする
 *  - ペアが崩れたノード化済み脚注へ .fn-unpaired を付けて色を戻す
 * 文書そのものは書き換えない（undo・カーソル・Markdown原文に影響なし）。
 *
 * 既知の限界: ソース上の \[^1] は remark がパース時にバックスラッシュを消費する
 * ため、ファイルを開いた後の doc 上では素の [^1] と区別できず青くなり得る
 * （エスケープ判定が効くのは WYSIWYG 上で直接入力されたバックスラッシュのみ）。
 */

import { Plugin, PluginKey } from "@milkdown/kit/prose/state";
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

interface Collected {
  /** テキスト状態のトークン。base は textblock コンテンツ開始の doc 位置。 */
  textTokens: { token: FnToken; base: number }[];
  nodeRefs: { label: string; pos: number; size: number }[];
  nodeDefs: { label: string; pos: number; size: number }[];
}

function collect(doc: ProseNode): Collected {
  const textTokens: Collected["textTokens"] = [];
  const nodeRefs: Collected["nodeRefs"] = [];
  const nodeDefs: Collected["nodeDefs"] = [];
  doc.descendants((node, pos) => {
    const name = node.type.name;
    if (name === "footnote_definition") {
      nodeDefs.push({ label: String(node.attrs.label), pos, size: node.nodeSize });
      return true; // 定義本文の段落内にも参照を書けるので中は走査する
    }
    if (name === "code_block") return false;
    if (node.isTextblock) {
      let text = "";
      node.forEach((child, offset) => {
        if (child.type.name === "footnote_reference") {
          nodeRefs.push({
            label: String(child.attrs.label),
            pos: pos + 1 + offset,
            size: child.nodeSize,
          });
          text += " ".repeat(child.nodeSize);
        } else if (child.type.name === "hardbreak") {
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
        textTokens.push({ token, base });
      }
      return false; // インラインは処理済み
    }
    return true;
  });
  return { textTokens, nodeRefs, nodeDefs };
}

function buildDecorations(doc: ProseNode): DecorationSet {
  const { textTokens, nodeRefs, nodeDefs } = collect(doc);
  const refLabels = new Set<string>();
  const defLabels = new Set<string>();
  for (const { token } of textTokens) {
    (token.kind === "ref" ? refLabels : defLabels).add(token.label);
  }
  for (const r of nodeRefs) refLabels.add(r.label);
  for (const d of nodeDefs) defLabels.add(d.label);
  const paired = (label: string): boolean =>
    refLabels.has(label) && defLabels.has(label);

  const decos: Decoration[] = [];
  // ペア成立したノード化済み脚注は既存CSS（sup/dt の accent 色）で青くなる
  // ため装飾不要。ここで扱うのはテキスト状態の着色と、ノードの色解除のみ。
  for (const { token, base } of textTokens) {
    if (!paired(token.label)) continue;
    decos.push(
      Decoration.inline(base + token.from, base + token.to, {
        class:
          token.kind === "ref" ? "fn-pair fn-pair-ref" : "fn-pair fn-pair-def",
        "data-fn-label": token.label,
      }),
    );
  }
  for (const r of nodeRefs) {
    if (paired(r.label)) continue;
    decos.push(Decoration.node(r.pos, r.pos + r.size, { class: "fn-unpaired" }));
  }
  for (const d of nodeDefs) {
    if (paired(d.label)) continue;
    decos.push(Decoration.node(d.pos, d.pos + d.size, { class: "fn-unpaired" }));
  }
  return decos.length > 0 ? DecorationSet.create(doc, decos) : DecorationSet.empty;
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
  props: {
    decorations(state) {
      return footnotePairKey.getState(state) ?? null;
    },
  },
});
