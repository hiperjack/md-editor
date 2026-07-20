import { describe, it, expect } from "vitest";
import { parseGantt, layoutSchedule, LAYOUT } from "./gantt-schedule";
import { renderScheduleGanttSvg } from "./gantt-schedule";

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
      "    section フェーズA",
      "    マイルストーンX :crit, milestone, 2026-07-31, 0d",
      "    タスクY :2027-05-20, 2027-06-30",
      "    section フェーズB",
      "    タスクZ :crit, 2027-01-01, 2027-04-30",
      "    タスクW :2026-07-01, 30d",
    ].join("\n");
    const m = parseGantt(src)!;
    expect(m.title).toBe("FY26");
    expect(m.sections.map((s) => s.name)).toEqual(["フェーズA", "フェーズB"]);

    const ms = m.sections[0].tasks[0];
    expect(ms.name).toBe("マイルストーンX");
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

describe("layoutSchedule", () => {
  const model = (lines: string[]) => parseGantt(["gantt", ...lines].join("\n"))!;

  it("非重複タスクは同じ行に詰め、重複すると行が増える", () => {
    const m = model([
      "section S",
      "a :2026-01-01, 2026-02-01",
      "b :2026-03-01, 2026-04-01", // a と重ならない → 同じ行
      "c :2026-01-15, 2026-03-15", // a とも b とも重なる → 別行
    ]);
    const layout = layoutSchedule(m, new Date(Date.UTC(2030, 0, 1)));
    const tasks = layout.boxes.filter((b) => b.kind === "task");
    const ys = new Set(tasks.map((b) => b.y));
    expect(ys.size).toBe(2); // 2行に収まる
  });

  it("マイルストーンは帯の先頭行、タスクはその下", () => {
    const m = model([
      "section S",
      "ms :milestone, 2026-02-01, 0d",
      "t :2026-01-01, 2026-03-01",
    ]);
    const layout = layoutSchedule(m, new Date(Date.UTC(2030, 0, 1)));
    const ms = layout.boxes.find((b) => b.kind === "milestone")!;
    const t = layout.boxes.find((b) => b.kind === "task")!;
    expect(ms.y).toBeLessThan(t.y);
  });

  it("月次目盛の数が範囲の月数と一致する", () => {
    const m = model([
      "section S",
      "t :2026-01-01, 2026-04-30", // 1,2,3,4月 = 4目盛
    ]);
    const layout = layoutSchedule(m, new Date(Date.UTC(2030, 0, 1)));
    expect(layout.ticks.map((x) => x.label)).toEqual([
      "26/01", "26/02", "26/03", "26/04",
    ]);
  });

  it("今日が範囲内なら todayX を持ち、範囲外なら null", () => {
    const m = model(["section S", "t :2026-01-01, 2026-04-30"]);
    const inside = layoutSchedule(m, new Date(Date.UTC(2026, 1, 15)));
    expect(inside.todayX).not.toBeNull();
    const outside = layoutSchedule(m, new Date(Date.UTC(2030, 0, 1)));
    expect(outside.todayX).toBeNull();
  });

  it("プロット幅は月数×pxPerMonth（下限・上限クランプ）", () => {
    const m = model(["section S", "t :2026-01-01, 2026-04-30"]); // 4ヶ月
    const layout = layoutSchedule(m, new Date(Date.UTC(2030, 0, 1)));
    // width = labelWidth + clamp(4*90, 600, 1600) + rightPad = 140 + 600 + 24 = 764
    expect(layout.width).toBe(
      LAYOUT.labelWidth + LAYOUT.minPlot + LAYOUT.rightPad,
    );
  });

  it("section名が短ければラベル幅は下限のまま", () => {
    const m = model(["section S", "t :2026-01-01, 2026-04-30"]); // "S" は1文字
    const layout = layoutSchedule(m, new Date(Date.UTC(2030, 0, 1)));
    expect(layout.labelWidth).toBe(LAYOUT.labelWidth);
  });

  it("section名が長ければラベル幅を拡張する（上限あり）", () => {
    const m = model([
      "section 分類名ラベルの長い見本",
      "t :2026-01-01, 2026-04-30",
    ]);
    const layout = layoutSchedule(m, new Date(Date.UTC(2030, 0, 1)));
    expect(layout.labelWidth).toBeGreaterThan(LAYOUT.labelWidth);
    expect(layout.labelWidth).toBeLessThanOrEqual(LAYOUT.labelMax);
  });
});

describe("renderScheduleGanttSvg", () => {
  const gantt = [
    "gantt",
    "    title FY26",
    "    section フェーズA",
    "    マイルストーンX :crit, milestone, 2026-07-31, 0d",
    "    タスクY :2027-05-20, 2027-06-30",
  ].join("\n");

  it("gantt以外は null（フォールバック）", () => {
    expect(renderScheduleGanttSvg("graph TD\n A-->B", "light")).toBeNull();
  });

  it("%%{init}%% 入りは null（フォールバック）", () => {
    expect(
      renderScheduleGanttSvg(`%%{init:{}}%%\n${gantt}`, "light"),
    ).toBeNull();
  });

  it("gantt を <svg> 文字列にする", () => {
    const svg = renderScheduleGanttSvg(gantt, "light")!;
    expect(svg.startsWith("<svg")).toBe(true);
    expect(svg).toContain("</svg>");
    expect(svg).toContain("タスクY");   // タスク名
    expect(svg).toContain("マイルストーンX");   // マイルストーン名
    expect(svg).toContain("polygon");    // 矢羽
    expect(svg).toContain('aria-roledescription="gantt"'); // 既存gantt後処理と同じ扱い
  });

  it("crit タスクは強調色クラスを持つ", () => {
    const svg = renderScheduleGanttSvg(gantt, "light")!;
    expect(svg).toContain("sched-crit");
  });

  it("右端寄りのマイルストーンはラベルを左（end）に反転する", () => {
    const src = [
      "gantt",
      "    section S",
      "    t :2026-01-01, 2026-01-31",
      "    ms :milestone, 2026-06-30, 0d",
    ].join("\n");
    const svg = renderScheduleGanttSvg(src, "light")!;
    expect(svg).toMatch(/class="sched-mslabel" text-anchor="end"/);
  });

  it("左端寄りのマイルストーンはラベルを右（start）のまま", () => {
    const src = [
      "gantt",
      "    section S",
      "    ms :milestone, 2026-01-01, 0d",
      "    t :2026-01-01, 2026-06-30",
    ].join("\n");
    const svg = renderScheduleGanttSvg(src, "light")!;
    expect(svg).toMatch(/class="sched-mslabel" text-anchor="start"/);
  });
});
