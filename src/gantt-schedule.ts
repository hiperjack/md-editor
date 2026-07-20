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
