import { describe, it, expect } from "vitest";
import { resolveImagePathCandidates } from "./image-resolver";

describe("resolveImagePathCandidates: パーセントエンコード", () => {
  const md = "C:\\docs\\note.md";

  it("相対パスの %20 をデコードした候補を先頭に、元表記を後ろに並べる", () => {
    expect(resolveImagePathCandidates("img/My%20Image.png", md)).toEqual([
      "C:\\docs\\img\\My Image.png",
      "C:\\docs\\img\\My%20Image.png",
    ]);
  });

  it("日本語ファイル名のエンコード形もデコードする", () => {
    expect(resolveImagePathCandidates("sub/%E7%94%BB%E5%83%8F.png", md)[0]).toBe(
      "C:\\docs\\sub\\画像.png",
    );
  });

  it("ベアファイル名は img/<md名>/ 優先の順序を保ったまま、デコード後→元表記の順に並べる", () => {
    expect(resolveImagePathCandidates("a%20b.png", md)).toEqual([
      "C:\\docs\\img\\note\\a b.png",
      "C:\\docs\\a b.png",
      "C:\\docs\\img\\note\\a%20b.png",
      "C:\\docs\\a%20b.png",
    ]);
  });

  it("絶対パスもデコードする", () => {
    expect(resolveImagePathCandidates("C:/pics/My%20Image.png", md)).toEqual([
      "C:/pics/My Image.png",
      "C:/pics/My%20Image.png",
    ]);
  });

  it("Windows 絶対パス（バックスラッシュ）はドライブレターを URL スキームと誤判定しない", () => {
    expect(resolveImagePathCandidates("C:\\pics\\a.png", md)).toEqual(["C:\\pics\\a.png"]);
  });

  it("エンコードを含まないパスは候補を増やさない", () => {
    expect(resolveImagePathCandidates("img/My Image.png", md)).toEqual([
      "C:\\docs\\img\\My Image.png",
    ]);
  });

  it("不正なエンコード（素の %）はそのまま扱う", () => {
    expect(resolveImagePathCandidates("img/100%.png", md)).toEqual([
      "C:\\docs\\img\\100%.png",
    ]);
  });

  it("markdown-it が % を %25 にした src は 1 回だけデコードする", () => {
    expect(resolveImagePathCandidates("img/100%25.png", md)[0]).toBe(
      "C:\\docs\\img\\100%.png",
    );
  });

  it("file:// URL はデコードした単一候補を返す", () => {
    expect(resolveImagePathCandidates("file:///C:/pics/My%20Image.png", md)).toEqual([
      "C:/pics/My Image.png",
    ]);
  });

  it("外部 URL は解決しない", () => {
    expect(resolveImagePathCandidates("https://example.com/a%20b.png", md)).toEqual([]);
  });
});
