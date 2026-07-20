import { describe, it, expect } from "vitest";
import { parseGantt } from "./gantt-schedule";

const utc = (s: string) => {
  const [y, m, d] = s.split("-").map(Number);
  return Date.UTC(y, m - 1, d);
};

describe("parseGantt", () => {
  it("gantt以外は null", () => {
    expect(parseGantt("graph TD\n A-->B")).toBeNull();
  });

  it("ユーザーが %%{init}%% を書いた図は null（フォールバック）", () => {
    const src = `%%{init: {"gantt": {}}}%%\ngantt\n section S\n t :2026-01-01, 2026-02-01`;
    expect(parseGantt(src)).toBeNull();
  });

  it("タスクが1つも無ければ null", () => {
    expect(parseGantt("gantt\n dateFormat YYYY-MM-DD")).toBeNull();
  });

  it("section・終了日形式・期間形式・crit・milestone を解釈する", () => {
    const src = [
      "gantt",
      "    title FY26",
      "    dateFormat YYYY-MM-DD",
      "    section 昇進",
      "    意思表明 :crit, milestone, 2026-07-31, 0d",
      "    プロセス :2027-05-20, 2027-06-30",
      "    section 次案件",
      "    契約 :crit, 2027-01-01, 2027-04-30",
      "    協業 :2026-07-01, 30d",
    ].join("\n");
    const m = parseGantt(src)!;
    expect(m.title).toBe("FY26");
    expect(m.sections.map((s) => s.name)).toEqual(["昇進", "次案件"]);

    const ms = m.sections[0].tasks[0];
    expect(ms.name).toBe("意思表明");
    expect(ms.isMilestone).toBe(true);
    expect(ms.isCrit).toBe(true);
    expect(ms.start.getTime()).toBe(utc("2026-07-31"));
    expect(ms.end.getTime()).toBe(utc("2026-07-31"));

    const proc = m.sections[0].tasks[1];
    expect(proc.isMilestone).toBe(false);
    expect(proc.start.getTime()).toBe(utc("2027-05-20"));
    expect(proc.end.getTime()).toBe(utc("2027-06-30"));

    const keiyaku = m.sections[1].tasks[0];
    expect(keiyaku.isCrit).toBe(true);
    expect(keiyaku.isMilestone).toBe(false);

    const kyogyo = m.sections[1].tasks[1];
    // 期間 30d: 2026-07-01 + 30日 = 2026-07-31
    expect(kyogyo.start.getTime()).toBe(utc("2026-07-01"));
    expect(kyogyo.end.getTime()).toBe(utc("2026-07-31"));

    expect(m.min.getTime()).toBe(utc("2026-07-01"));
    expect(m.max.getTime()).toBe(utc("2027-06-30"));
  });

  it("ゼロ埋めなし日付を許容する", () => {
    const src = "gantt\n section S\n t :2026-9-1, 2026-9-30";
    const m = parseGantt(src)!;
    expect(m.sections[0].tasks[0].start.getTime()).toBe(utc("2026-09-01"));
  });

  it("開始日が解釈できないタスク行があれば null", () => {
    const src = "gantt\n section S\n t :crit, someday";
    expect(parseGantt(src)).toBeNull();
  });

  it("title/dateFormat/axisFormat/tickInterval 等のキーワード行はタスクにしない", () => {
    const src = [
      "gantt",
      "    dateFormat YYYY-MM-DD",
      "    axisFormat %y-%m",
      "    tickInterval 1month",
      "    section S",
      "    t :2026-01-01, 2026-02-01",
    ].join("\n");
    const m = parseGantt(src)!;
    expect(m.sections[0].tasks).toHaveLength(1);
  });
});
