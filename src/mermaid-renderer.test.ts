import { describe, it, expect } from "vitest";
import { ganttInitDirective } from "./mermaid-renderer";

/** テスト用の最小gantt。セクション名2文字・タスク名3文字（どちらも短い）。 */
const SHORT_GANTT = `gantt
    dateFormat YYYY-MM-DD
    section 短い
    タスク :2026-01-01, 30d`;

describe("ganttInitDirective", () => {
  it("gantt以外の図には何もしない", () => {
    expect(ganttInitDirective("graph TD\n  A --> B")).toBeNull();
  });

  it("ユーザーが %%{init}%% を書いている図には手を出さない", () => {
    const src = `%%{init: {"gantt": {"leftPadding": 200}}}%%\n${SHORT_GANTT}`;
    expect(ganttInitDirective(src)).toBeNull();
  });

  it("短いセクション名・タスク名では leftPadding=150 / プロット900px", () => {
    // leftPadding: max(150, 10 + 2*20 + 30) = 150、幅: 150 + 75 + 900 = 1125
    expect(ganttInitDirective(SHORT_GANTT)).toBe(
      '%%{init: {"gantt": {"leftPadding": 150, "useWidth": 1125}}}%%\n',
    );
  });

  it("長いセクション名から leftPadding を見積もる（最大320px）", () => {
    const src = `gantt
    dateFormat YYYY-MM-DD
    section 分類名ラベルの長い見本
    タスク :2026-01-01, 30d`;
    // 全角11文字 → 10 + 11*20 + 30 = 260
    expect(ganttInitDirective(src)).toContain('"leftPadding": 260');
  });

  it("長いタスク名ではプロット幅を広げる（見切れ・詰まり防止）", () => {
    const src = `gantt
    dateFormat YYYY-MM-DD
    section 分類名ラベルの長い見本
    ${"作".repeat(35)} :2026-07-01, 2027-04-30`;
    // タスク名: 全角35文字 → 700px
    // プロット: max(900, 700*2) = 1400、幅: 260 + 75 + 1400 = 1735
    expect(ganttInitDirective(src)).toBe(
      '%%{init: {"gantt": {"leftPadding": 260, "useWidth": 1735}}}%%\n',
    );
  });

  it("プロット幅の拡大には上限がある", () => {
    const longName = "あ".repeat(100); // 2000px相当
    const src = `gantt
    dateFormat YYYY-MM-DD
    section S
    ${longName} :2026-01-01, 30d`;
    // プロット上限1600、leftPadding 150 → 150 + 75 + 1600 = 1825
    expect(ganttInitDirective(src)).toContain('"useWidth": 1825');
  });

  it("<br>入りタスク名は行ごとに測る", () => {
    const src = `gantt
    dateFormat YYYY-MM-DD
    section S
    あいう<br>えお :2026-01-01, 30d`;
    // 最長行3文字=60px → 基準の900のまま
    expect(ganttInitDirective(src)).toContain('"useWidth": 1125');
  });

  it("todayMarker等のコロン入りキーワード行はタスク名として測らない", () => {
    const src = `gantt
    dateFormat YYYY-MM-DD
    todayMarker stroke-width:5px,stroke:#0f0,opacity:0.5
    section 短い
    タスク :2026-01-01, 30d`;
    expect(ganttInitDirective(src)).toContain('"useWidth": 1125');
  });

  it("%%コメント行は測らない", () => {
    const src = `gantt
    dateFormat YYYY-MM-DD
    %% ながいながいながいながいながいながいコメント: メモ
    section 短い
    タスク :2026-01-01, 30d`;
    expect(ganttInitDirective(src)).toContain('"useWidth": 1125');
  });

  it("セクションもタスクも無ければ null", () => {
    expect(ganttInitDirective("gantt\n    dateFormat YYYY-MM-DD")).toBeNull();
  });

  it("期間が長い図はプロット幅を月数に応じて広げる", () => {
    // 2026-07-01〜2027-09-30 = 456日 ≈ 14.98ヶ月 → round(14.98×90) = 1348
    // タスク名は短い（拡大の根拠にならない）
    const src = `gantt
    dateFormat YYYY-MM-DD
    section 工程管理表示
    作業一 :2026-07-01, 2026-11-30
    作業二 :2027-05-01, 2027-09-30`;
    // leftPadding: 全角6文字 → max(150, 10+120+30) = 160
    expect(ganttInitDirective(src)).toBe(
      '%%{init: {"gantt": {"leftPadding": 160, "useWidth": 1583}}}%%\n',
    );
  });

  it("期間が短い図は基準900pxのまま", () => {
    const src = `gantt
    dateFormat YYYY-MM-DD
    section S
    タスク :2026-01-01, 2026-03-31`;
    expect(ganttInitDirective(src)).toContain('"useWidth": 1125');
  });

  it("ゼロ埋めなし・存在しない日付でも期間の概算に使える", () => {
    // 2026-9-01 と 2027-02-31（2027-03-03扱い）→ 約6ヶ月 → 900のまま
    const src = `gantt
    dateFormat YYYY-MM-DD
    section S
    タスク :2026-9-01, 2027-02-31`;
    expect(ganttInitDirective(src)).toContain('"useWidth": 1125');
  });
});
