import { describe, it, expect } from "vitest";
import { PROPOSAL_RE, sanitizeProposal } from "./chat-proposal";

describe("PROPOSAL_RE", () => {
  it("前後の説明文があっても提案本文を抽出する", () => {
    const reply = "書き込みますね。\n\n<mdedit-proposal>\n# タイトル\n\n本文\n</mdedit-proposal>\n\n以上です。";
    const m = PROPOSAL_RE.exec(reply);
    expect(m?.[1]).toBe("# タイトル\n\n本文");
  });

  it("本文内に閉じマーカー行があっても最後の閉じマーカーまで取る（貪欲）", () => {
    const inner = "説明\n</mdedit-proposal>\nの例";
    const reply = `<mdedit-proposal>\n${inner}\n</mdedit-proposal>`;
    const m = PROPOSAL_RE.exec(reply);
    expect(m?.[1]).toBe(inner);
  });
});

describe("sanitizeProposal", () => {
  it("末尾に混入した </document> を除去する（実例ケース）", () => {
    const raw = "本文の行\n\n\n\n[^1]: テスト\n\n</document>";
    expect(sanitizeProposal(raw)).toBe("本文の行\n\n\n\n[^1]: テスト");
  });

  it("先頭に混入した <document ...> を除去する", () => {
    const raw = '<document title="x.md">\n# 見出し\n本文';
    expect(sanitizeProposal(raw)).toBe("# 見出し\n本文");
  });

  it("枠タグが無ければそのまま（前後の空行だけ整える）", () => {
    expect(sanitizeProposal("\n# A\n\n本文\n\n")).toBe("# A\n\n本文");
  });

  it("本文中の </document> という文字列は消さない（行末尾のタグのみ）", () => {
    const raw = "説明: </document> はタグです\n次の行";
    expect(sanitizeProposal(raw)).toBe(raw);
  });
});
