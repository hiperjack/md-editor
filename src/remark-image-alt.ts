import { $remark } from "@milkdown/kit/utils";
import { parseImageAlt } from "./image-row";

/**
 * 代替テキストを持つ単独行の画像を、画像ブロックにせずインライン画像のまま残す remark プラグイン。
 *
 * Crepe（@milkdown/components の remark-image-block）は「画像 1 枚だけの段落」を
 * image-block へ変換するが、image-block は src / caption（= title）/ ratio（= alt の数値）
 * しか持たず、`![説明|300](img.png)` の「説明」が読込時に捨てられ、保存で消えてしまう。
 * インライン画像は alt をそのまま保持できる（幅は alt の `|300` 部分で表す）ため、
 * alt に代替テキストがある画像だけ paragraph > image の形に戻す。
 * alt が空か数値だけの画像は従来どおり image-block として扱う。
 */
type MdNode = {
  type: string;
  children?: MdNode[];
  url?: string;
  alt?: string | null;
  title?: string | null;
};

export function remarkKeepAltImagesInline() {
  return (tree: MdNode) => {
    walk(tree);
  };
}

function walk(node: MdNode): void {
  if (!node.children) return;
  node.children = node.children.map((child) => {
    if (child.type === "image-block" && parseImageAlt(child.alt).text !== "") {
      return {
        type: "paragraph",
        children: [
          { type: "image", url: child.url, alt: child.alt, title: child.title },
        ],
      };
    }
    walk(child);
    return child;
  });
}

/** Milkdown 用のプラグイン。Crepe の機能より後に `editor.use` すること。 */
export const remarkKeepAltImagesInlinePlugin = $remark(
  "remark-keep-alt-images-inline",
  () => remarkKeepAltImagesInline,
);
