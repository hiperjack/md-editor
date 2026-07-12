import { describe, it, expect } from "vitest";
import { parseUsage, ringChar, ringColor, fmtReset, usageErrorKey } from "./usage";

/** 実際の /api/oauth/usage レスポンスを縮約したフィクスチャ。 */
const FIXTURE = JSON.stringify({
  five_hour: {
    utilization: 29.0,
    resets_at: "2026-07-12T02:10:00.066215+00:00",
  },
  seven_day: {
    utilization: 17.0,
    resets_at: "2026-07-18T09:00:00.066246+00:00",
  },
  limits: [
    {
      kind: "session",
      group: "session",
      percent: 29,
      severity: "normal",
      resets_at: "2026-07-12T02:10:00.066215+00:00",
      scope: null,
      is_active: false,
    },
    {
      kind: "weekly_all",
      group: "weekly",
      percent: 17,
      severity: "normal",
      resets_at: "2026-07-18T09:00:00.066246+00:00",
      scope: null,
      is_active: false,
    },
    {
      kind: "weekly_scoped",
      group: "weekly",
      percent: 30,
      severity: "normal",
      resets_at: "2026-07-18T09:00:00.066686+00:00",
      scope: { model: { id: null, display_name: "Fable" }, surface: null },
      is_active: true,
    },
  ],
});

describe("parseUsage", () => {
  it("5h/7dの使用率とリセット時刻を取り出す", () => {
    const d = parseUsage(FIXTURE);
    expect(d.fiveHour).toEqual({
      utilization: 29.0,
      resetsAt: "2026-07-12T02:10:00.066215+00:00",
    });
    expect(d.sevenDay).toEqual({
      utilization: 17.0,
      resetsAt: "2026-07-18T09:00:00.066246+00:00",
    });
  });

  it("モデル別上限は scope.model.display_name を持つ limits だけを拾う", () => {
    const d = parseUsage(FIXTURE);
    expect(d.scoped).toEqual([
      {
        label: "Fable",
        percent: 30,
        resetsAt: "2026-07-18T09:00:00.066686+00:00",
      },
    ]);
  });

  it("欠けたフィールドは null / 空配列になる", () => {
    const d = parseUsage("{}");
    expect(d.fiveHour).toBeNull();
    expect(d.sevenDay).toBeNull();
    expect(d.scoped).toEqual([]);
  });

  it("不正JSONは例外を投げる", () => {
    expect(() => parseUsage("not json")).toThrow();
  });
});

describe("ringChar", () => {
  it("25%刻みで ○◔◑◕● を返す", () => {
    expect(ringChar(0)).toBe("○");
    expect(ringChar(24)).toBe("○");
    expect(ringChar(25)).toBe("◔");
    expect(ringChar(49)).toBe("◔");
    expect(ringChar(50)).toBe("◑");
    expect(ringChar(74)).toBe("◑");
    expect(ringChar(75)).toBe("◕");
    expect(ringChar(99)).toBe("◕");
    expect(ringChar(100)).toBe("●");
    expect(ringChar(120)).toBe("●"); // 上限クランプ
    expect(ringChar(-5)).toBe("○"); // 下限クランプ
  });
});

describe("ringColor", () => {
  it("statuslineと同じ緑→赤グラデーション", () => {
    expect(ringColor(0)).toBe("rgb(0,200,80)");
    expect(ringColor(50)).toBe("rgb(255,200,60)");
    expect(ringColor(100)).toBe("rgb(255,0,60)");
  });
});

describe("fmtReset", () => {
  it("ローカル時刻 M/D HH:MM で整形する", () => {
    // オフセット無しISOはローカル時刻として解釈されるため、TZに依存しない
    expect(fmtReset("2026-07-12T11:10:00")).toBe("7/12 11:10");
    expect(fmtReset("2026-01-02T05:07:00")).toBe("1/2 05:07");
  });

  it("null・不正値は空文字", () => {
    expect(fmtReset(null)).toBe("");
    expect(fmtReset("garbage")).toBe("");
  });
});

describe("usageErrorKey", () => {
  it("認証系エラーは errAuth、それ以外は errFetch", () => {
    expect(usageErrorKey("no-credentials")).toBe("usage.errAuth");
    expect(usageErrorKey("unauthorized")).toBe("usage.errAuth");
    expect(usageErrorKey("network: timeout")).toBe("usage.errFetch");
    expect(usageErrorKey("http-500")).toBe("usage.errFetch");
    expect(usageErrorKey(new Error("boom"))).toBe("usage.errFetch");
  });
});
