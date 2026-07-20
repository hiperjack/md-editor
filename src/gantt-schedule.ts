export type GanttTask = {
  name: string;
  start: Date;
  end: Date;
  isMilestone: boolean;
  isCrit: boolean;
};
export type GanttSection = { name: string; tasks: GanttTask[] };
export type GanttModel = {
  title: string | null;
  sections: GanttSection[];
  min: Date;
  max: Date;
};

// タスク行以外でコロンを含みうるキーワード行・コメント行
const NON_TASK =
  /^[ \t]*(?:%%|gantt\b|title\b|dateFormat\b|axisFormat\b|tickInterval\b|includes\b|excludes\b|todayMarker\b|weekday\b|weekend\b|inclusiveEndDates\b|topAxis\b|displayMode\b|section\b|accTitle\b|accDescr\b|click\b)/;

/** "YYYY-M-D"（ゼロ埋めなし可）→ UTC Date。解釈不能なら null。 */
function parseDate(token: string): Date | null {
  const m = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(token.trim());
  if (!m) return null;
  const [, y, mo, d] = m;
  return new Date(Date.UTC(Number(y), Number(mo) - 1, Number(d)));
}

/** "30d" / "2w" → 日数。該当しなければ null。 */
function parseDuration(token: string): number | null {
  const m = /^(\d+)\s*([dw])$/.exec(token.trim());
  if (!m) return null;
  return Number(m[1]) * (m[2] === "w" ? 7 : 1);
}

function addDays(base: Date, days: number): Date {
  return new Date(base.getTime() + days * 24 * 60 * 60 * 1000);
}

const TAGS = new Set(["crit", "milestone", "active", "done"]);

export function parseGantt(source: string): GanttModel | null {
  if (!/^\s*gantt\b/.test(source)) return null;
  if (source.includes("%%{")) return null;

  let title: string | null = null;
  const sections: GanttSection[] = [];
  let current: GanttSection | null = null;

  for (const rawLine of source.split("\n")) {
    const line = rawLine.trim();
    if (!line) continue;
    const titleM = /^title[ \t]+(.+)$/.exec(line);
    if (titleM) {
      title = titleM[1].trim();
      continue;
    }
    const secM = /^section[ \t]+(.+)$/.exec(line);
    if (secM) {
      current = { name: secM[1].trim(), tasks: [] };
      sections.push(current);
      continue;
    }
    if (NON_TASK.test(rawLine)) continue;

    // タスク行 "name :meta"。name にコロンは不可（mermaid文法）。
    const taskM = /^([^:\n]+):(.*)$/.exec(line);
    if (!taskM) continue;
    const name = taskM[1].trim();
    const meta = taskM[2].split(",").map((s) => s.trim()).filter(Boolean);

    let isCrit = false;
    let isMilestone = false;
    let start: Date | null = null;
    let end: Date | null = null;
    let duration: number | null = null;
    for (const tok of meta) {
      if (TAGS.has(tok)) {
        if (tok === "crit") isCrit = true;
        if (tok === "milestone") isMilestone = true;
        continue;
      }
      const d = parseDate(tok);
      if (d) {
        if (!start) start = d;
        else end = d;
        continue;
      }
      const dur = parseDuration(tok);
      if (dur !== null) duration = dur;
    }
    if (!start) return null; // 開始日が取れない＝PPT化不可 → フォールバック
    if (!end) end = duration !== null ? addDays(start, duration) : start;
    if (end.getTime() === start.getTime()) isMilestone = isMilestone || duration === 0;

    const task: GanttTask = { name, start, end, isMilestone, isCrit };
    if (!current) {
      current = { name: "", tasks: [] };
      sections.push(current);
    }
    current.tasks.push(task);
  }

  const all = sections.flatMap((s) => s.tasks);
  if (all.length === 0) return null;
  const min = new Date(Math.min(...all.map((t) => t.start.getTime())));
  const max = new Date(Math.max(...all.map((t) => t.end.getTime())));
  return { title, sections, min, max };
}

export type PlacedBox = {
  x: number; y: number; w: number; h: number;
  label: string;
  kind: "task" | "milestone";
  isCrit: boolean;
};
export type MonthTick = { x: number; label: string };
export type SectionBand = { name: string; y: number; h: number };
export type ScheduleLayout = {
  width: number;
  height: number;
  labelWidth: number;
  headerHeight: number;
  ticks: MonthTick[];
  bands: SectionBand[];
  boxes: PlacedBox[];
  todayX: number | null;
};

export const LAYOUT = {
  labelWidth: 140,
  headerHeight: 40,
  rowHeight: 34,
  rowGap: 6,
  bandPadY: 8,
  pxPerMonth: 90,
  minPlot: 600,
  maxPlot: 1600,
} as const;

function monthStart(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1));
}
function monthCount(a: Date, b: Date): number {
  return (
    (b.getUTCFullYear() - a.getUTCFullYear()) * 12 +
    (b.getUTCMonth() - a.getUTCMonth()) +
    1
  );
}
function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

export function layoutSchedule(
  model: GanttModel,
  today: Date = new Date(),
): ScheduleLayout {
  const rangeStart = monthStart(model.min);
  // 範囲末は max の翌月頭（右端まで使う）
  const endMonth = monthStart(model.max);
  const rangeEnd = new Date(
    Date.UTC(endMonth.getUTCFullYear(), endMonth.getUTCMonth() + 1, 1),
  );
  const months = monthCount(model.min, model.max);
  const plot = Math.min(
    LAYOUT.maxPlot,
    Math.max(LAYOUT.minPlot, months * LAYOUT.pxPerMonth),
  );
  const span = rangeEnd.getTime() - rangeStart.getTime();
  const xOf = (d: Date): number =>
    LAYOUT.labelWidth + ((d.getTime() - rangeStart.getTime()) / span) * plot;

  const ticks: MonthTick[] = [];
  for (let i = 0; i < months; i++) {
    const m = new Date(
      Date.UTC(rangeStart.getUTCFullYear(), rangeStart.getUTCMonth() + i, 1),
    );
    ticks.push({
      x: xOf(m),
      label: `${pad2(m.getUTCFullYear() % 100)}/${pad2(m.getUTCMonth() + 1)}`,
    });
  }

  const boxes: PlacedBox[] = [];
  const bands: SectionBand[] = [];
  let y: number = LAYOUT.headerHeight;

  for (const section of model.sections) {
    const bandTop = y;
    let rowY = y + LAYOUT.bandPadY;

    const milestones = section.tasks.filter((t) => t.isMilestone);
    const tasks = section.tasks.filter((t) => !t.isMilestone);

    if (milestones.length > 0) {
      for (const ms of milestones) {
        boxes.push({
          x: xOf(ms.start),
          y: rowY,
          w: 0,
          h: LAYOUT.rowHeight,
          label: ms.name,
          kind: "milestone",
          isCrit: ms.isCrit,
        });
      }
      rowY += LAYOUT.rowHeight + LAYOUT.rowGap;
    }

    // 貪欲な行詰め込み: 開始日昇順、各行の末尾endを保持
    const sorted = [...tasks].sort(
      (a, b) => a.start.getTime() - b.start.getTime(),
    );
    const rowEnds: number[] = [];
    for (const t of sorted) {
      let row = rowEnds.findIndex((end) => end <= t.start.getTime());
      if (row === -1) {
        row = rowEnds.length;
        rowEnds.push(0);
      }
      rowEnds[row] = t.end.getTime();
      const x = xOf(t.start);
      const w = Math.max(2, xOf(t.end) - x);
      boxes.push({
        x,
        y: rowY + row * (LAYOUT.rowHeight + LAYOUT.rowGap),
        w,
        h: LAYOUT.rowHeight,
        label: t.name,
        kind: "task",
        isCrit: t.isCrit,
      });
    }
    const taskRows = rowEnds.length;
    rowY += taskRows * (LAYOUT.rowHeight + LAYOUT.rowGap);

    const bandBottom = rowY + LAYOUT.bandPadY - LAYOUT.rowGap;
    bands.push({ name: section.name, y: bandTop, h: bandBottom - bandTop });
    y = bandBottom;
  }

  const todayIn =
    today.getTime() >= rangeStart.getTime() &&
    today.getTime() <= rangeEnd.getTime();

  return {
    width: LAYOUT.labelWidth + plot,
    height: y,
    labelWidth: LAYOUT.labelWidth,
    headerHeight: LAYOUT.headerHeight,
    ticks,
    bands,
    boxes,
    todayX: todayIn ? xOf(today) : null,
  };
}
