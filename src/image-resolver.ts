import { convertFileSrc } from "@tauri-apps/api/core";
import { store } from "./store";

/**
 * Markdown 中の画像パスを Tauri asset URL へ書き換える層。
 *
 * - `http(s)://` / `data:` / `blob:` / `asset.localhost` などはそのまま
 * - 絶対パス（"C:\..." または "/..."）は asset URL に変換
 * - 相対パスは markdown ファイルの所在ディレクトリを基準に解決して asset URL に変換
 * - 未保存タブ（filePath が null）のとき、相対パスは解決できないので元の値を返す
 */

function isExternalUrl(src: string): boolean {
  return /^(?:[a-z]+:|\/\/|#)/i.test(src);
}

function isWindowsAbsolute(src: string): boolean {
  return /^[a-zA-Z]:[\\/]/.test(src);
}

function isPosixAbsolute(src: string): boolean {
  return src.startsWith("/");
}

/** ファイル絶対パスから親ディレクトリを取り出す（クロスプラットフォーム）。 */
function dirname(filePath: string): string {
  const i = Math.max(filePath.lastIndexOf("/"), filePath.lastIndexOf("\\"));
  if (i < 0) return "";
  return filePath.slice(0, i);
}

/**
 * mdファイルのディレクトリと相対パスを連結する。
 * `../` や `./` を畳み込み、最終的に絶対パスを返す。
 */
function joinPath(baseDir: string, rel: string): string {
  // 区切り文字を / に正規化してから処理し、最後にプラットフォームに戻す。
  const sep = baseDir.includes("\\") ? "\\" : "/";
  const baseParts = baseDir.replace(/\\/g, "/").split("/").filter(Boolean);
  const baseHadDriveLetter = /^[a-zA-Z]:$/.test(
    baseDir.replace(/\\/g, "/").split("/")[0] ?? "",
  );
  const baseHadLeadingSlash = baseDir.startsWith("/");
  const relParts = rel.replace(/\\/g, "/").split("/").filter(Boolean);
  const merged = [...baseParts];
  for (const p of relParts) {
    if (p === ".") continue;
    if (p === "..") merged.pop();
    else merged.push(p);
  }
  let joined = merged.join(sep);
  if (baseHadLeadingSlash && !baseHadDriveLetter) joined = sep + joined;
  return joined;
}

/** ファイル名から拡張子を除いた basename を返す。 */
function basenameWithoutExt(filePath: string): string {
  const i = Math.max(filePath.lastIndexOf("/"), filePath.lastIndexOf("\\"));
  const base = i >= 0 ? filePath.slice(i + 1) : filePath;
  const dot = base.lastIndexOf(".");
  return dot > 0 ? base.slice(0, dot) : base;
}

/**
 * 「ベアファイル名」 = ディレクトリ区切りも `.`/`..` 接頭辞も持たない単純な名前。
 * 例: `cover.png`, `note-01.jpg` ✓ / `./img.png`, `sub/x.png` ✗
 */
function isBareFilename(src: string): boolean {
  if (!src) return false;
  if (src.includes("/") || src.includes("\\")) return false;
  if (src.startsWith(".")) return false;
  return true;
}

/**
 * md ファイルパスから、貼り付け画像の保存先ディレクトリを返す。
 * 解決規約（ベアファイル名 → <mdDir>/img/<md名>/file）と同じ基準。
 * mdFilePath が無い、または親ディレクトリが取れない場合は null。
 */
export function imageDirForMdPath(mdFilePath: string | null): string | null {
  if (!mdFilePath) return null;
  const baseDir = dirname(mdFilePath);
  if (!baseDir) return null;
  const stem = basenameWithoutExt(mdFilePath);
  return joinPath(baseDir, "img/" + stem);
}

/**
 * markdown 上の画像 src を、絶対ファイルパスの候補（優先順）に解決する。
 * HTML出力時の data URI 埋め込み（Rustでのファイル読み込み）用。
 *
 * - 外部URL (http/data/blob 等) → 空配列
 * - `file://` / 絶対パス → 単一候補
 * - 相対パス → md ディレクトリ基準の単一候補
 * - 「ベアファイル名」 → `<mdDir>/img/<mdBasename>/<file>` 優先、`<mdDir>/<file>` フォールバック
 */
export function resolveImagePathCandidates(
  src: string,
  mdFilePath: string | null,
): string[] {
  if (!src) return [];
  if (isExternalUrl(src) && !src.startsWith("file:")) return [];
  if (src.startsWith("file://")) {
    try {
      return [decodeURI(src.replace(/^file:\/\/\/?/, ""))];
    } catch {
      return [];
    }
  }
  if (isWindowsAbsolute(src) || isPosixAbsolute(src)) {
    return [src];
  }
  if (!mdFilePath) return [];
  const baseDir = dirname(mdFilePath);
  if (!baseDir) return [];

  if (isBareFilename(src)) {
    const stem = basenameWithoutExt(mdFilePath);
    return [joinPath(joinPath(baseDir, "img/" + stem), src), joinPath(baseDir, src)];
  }

  return [joinPath(baseDir, src)];
}

/**
 * markdown 上の画像 src に対して、試行する asset URL の候補を優先順で返す。
 * 1つ目で読み込めなければ呼び出し側で次の候補に切り替えてフォールバックする想定。
 * 候補の決め方は resolveImagePathCandidates と同じ。
 */
export function resolveImageCandidates(
  src: string,
  mdFilePath: string | null,
): string[] {
  return resolveImagePathCandidates(src, mdFilePath).map((p) =>
    convertFileSrc(p),
  );
}

/**
 * markdown 上の画像 src を、WebView で読み込める URL に解決する。
 * 候補が複数ある場合は最初のものを返す。解決できない場合は null。
 * 旧API互換のため残してあるが、フォールバックを使うときは
 * resolveImageCandidates を直接使うこと。
 */
export function resolveImageSrc(
  src: string,
  mdFilePath: string | null,
): string | null {
  const list = resolveImageCandidates(src, mdFilePath);
  return list[0] ?? null;
}

/** Tauri が convertFileSrc で返す形式かどうか。再度処理しないための判定。 */
function isAssetUrl(src: string): boolean {
  return /^(?:https?:\/\/asset\.|asset:\/\/)/.test(src);
}

/**
 * 編集ペイン内の `<img>` を監視し、markdown 上の値（相対 / 絶対 / file:// 等）を
 * Tauri の asset URL に書き換える。markdown ファイルパスが変わったときには
 * data-md-src に保存しておいた元値で再解決する。
 *
 * 戻り値はクリーンアップ関数。
 */
export function attachImageResolver(
  container: HTMLElement,
  getMdFilePath: () => string | null,
): () => void {
  // 各 img の現在の error フォールバックハンドラ。再書き換え時に古いものを外すために保持。
  const errorHandlers = new WeakMap<HTMLImageElement, EventListener>();

  /** img に候補リストを適用し、最初のURLをセットする。失敗時は次の候補に切り替える。 */
  const applyCandidates = (img: HTMLImageElement, list: string[]) => {
    // 古いハンドラがあれば外す
    const old = errorHandlers.get(img);
    if (old) {
      img.removeEventListener("error", old);
      errorHandlers.delete(img);
    }
    if (list.length === 0) return;

    if (list.length > 1) {
      let idx = 0;
      const handler: EventListener = () => {
        idx++;
        if (idx >= list.length) {
          img.removeEventListener("error", handler);
          errorHandlers.delete(img);
          return;
        }
        if (img.getAttribute("src") !== list[idx]) {
          img.setAttribute("src", list[idx]);
        }
      };
      img.addEventListener("error", handler);
      errorHandlers.set(img, handler);
    }

    if (img.getAttribute("src") !== list[0]) {
      img.setAttribute("src", list[0]);
    }
  };

  const rewrite = (img: HTMLImageElement) => {
    const cur = img.getAttribute("src") ?? "";
    if (!cur) return;
    // 既に asset URL なら触らない（自分や他レイヤが書いたものを尊重）
    if (isAssetUrl(cur)) return;
    img.dataset.mdSrc = cur;
    const list = resolveImageCandidates(cur, getMdFilePath());
    applyCandidates(img, list);
  };

  // 初期スキャン
  container.querySelectorAll<HTMLImageElement>("img").forEach(rewrite);

  // 動的に追加された img / src 変更を捕捉
  const observer = new MutationObserver((muts) => {
    for (const m of muts) {
      if (m.type === "attributes" && m.target instanceof HTMLImageElement) {
        rewrite(m.target);
      } else if (m.type === "childList") {
        for (const n of m.addedNodes) {
          if (n instanceof HTMLImageElement) rewrite(n);
          else if (n instanceof HTMLElement) {
            n.querySelectorAll<HTMLImageElement>("img").forEach(rewrite);
          }
        }
      }
    }
  });
  observer.observe(container, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ["src"],
  });

  // 「名前を付けて保存」等で md ファイルパスが変わったら、保存した raw 値で再解決
  const unsubStore = store.subscribe(() => {
    container.querySelectorAll<HTMLImageElement>("img").forEach((img) => {
      const raw = img.dataset.mdSrc;
      if (!raw) return;
      const list = resolveImageCandidates(raw, getMdFilePath());
      applyCandidates(img, list);
    });
  });

  return () => {
    observer.disconnect();
    unsubStore();
  };
}
