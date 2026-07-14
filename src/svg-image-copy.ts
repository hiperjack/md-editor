/**
 * Mermaid図のSVGをPNGにラスタライズしてクリップボードへコピーする。
 * 右クリックメニューの「画像としてコピー」用。
 *
 * - htmlLabels:false 運用のため foreignObject は含まれず、<img> 経由の
 *   ラスタライズでcanvasが汚染されない。テキストはシステムフォントで描ける。
 * - 貼り付け先（Officeやチャット等）の背景と混ざらないよう、
 *   背景色を敷いた不透明PNGにする。
 */

/** 出力解像度の倍率。表示サイズの2倍で書き出す（Retina/拡大貼り付け向け）。 */
const RASTER_SCALE = 2;

export async function copySvgAsImage(
  svgEl: SVGSVGElement,
  background: string,
): Promise<boolean> {
  try {
    const vb = svgEl.viewBox?.baseVal;
    const rect = svgEl.getBoundingClientRect();
    const w = vb && vb.width > 0 ? vb.width : rect.width || 600;
    const h = vb && vb.height > 0 ? vb.height : rect.height || 400;
    // 表示用のインラインサイズ指定（width:100% / max-width等）を外した
    // クローンを固有サイズで描く
    const clone = svgEl.cloneNode(true) as SVGSVGElement;
    clone.removeAttribute("style");
    clone.setAttribute("width", String(w));
    clone.setAttribute("height", String(h));
    if (!clone.getAttribute("xmlns")) {
      clone.setAttribute("xmlns", "http://www.w3.org/2000/svg");
    }
    const svgText = new XMLSerializer().serializeToString(clone);
    const url = URL.createObjectURL(
      new Blob([svgText], { type: "image/svg+xml" }),
    );
    try {
      const img = new Image();
      await new Promise<void>((resolve, reject) => {
        img.onload = () => resolve();
        img.onerror = () => reject(new Error("svg image load failed"));
        img.src = url;
      });
      const canvas = document.createElement("canvas");
      canvas.width = Math.round(w * RASTER_SCALE);
      canvas.height = Math.round(h * RASTER_SCALE);
      const ctx = canvas.getContext("2d");
      if (!ctx) return false;
      ctx.fillStyle = background;
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      const blob = await new Promise<Blob | null>((resolve) =>
        canvas.toBlob(resolve, "image/png"),
      );
      if (!blob) return false;
      await navigator.clipboard.write([
        new ClipboardItem({ "image/png": blob }),
      ]);
      return true;
    } finally {
      URL.revokeObjectURL(url);
    }
  } catch (e) {
    console.warn("copySvgAsImage failed:", e);
    return false;
  }
}

/**
 * 要素の実効背景色（transparent を親へ遡って解決）。
 * 図のコピー時に台紙として敷く色を決めるのに使う。
 */
export function effectiveBackground(el: Element | null): string {
  for (let cur = el; cur; cur = cur.parentElement) {
    const bg = getComputedStyle(cur).backgroundColor;
    if (bg && bg !== "transparent" && bg !== "rgba(0, 0, 0, 0)") return bg;
  }
  return getComputedStyle(document.body).backgroundColor || "#ffffff";
}
