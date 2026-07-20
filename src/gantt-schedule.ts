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
// x: 月境界のグリッド線位置。labelX: ラベルを置く月カラムの中央（線と線の間）。
export type MonthTick = { x: number; labelX: number; label: string };
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
  labelMax: 260,
  headerHeight: 40,
  rowHeight: 34,
  rowGap: 6,
  bandPadY: 8,
  pxPerMonth: 90,
  minPlot: 600,
  maxPlot: 1600,
  rightPad: 24,
} as const;

const SECTION_FONT = 14;

/** section名の最長行の概算幅（全角=1、半角=0.5文字ぶん）。<br> は行分割して最長行のみ見る。 */
function measureLabel(text: string): number {
  let max = 0;
  for (const line of text.split(/<br\s*\/?>/i)) {
    let len = 0;
    for (const ch of line.trim())
      len += (ch.codePointAt(0) ?? 0) > 0xff ? 1 : 0.5;
    max = Math.max(max, len);
  }
  return max;
}

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
  // 左ラベル列は section 名の長さに応じて可変（短い名前は下限140pxのまま）。
  const maxSectionMeasure =
    model.sections.length > 0
      ? Math.max(...model.sections.map((s) => measureLabel(s.name)))
      : 0;
  const labelWidth = Math.min(
    LAYOUT.labelMax,
    Math.max(LAYOUT.labelWidth, Math.round(maxSectionMeasure * SECTION_FONT + 20)),
  );

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
    labelWidth + ((d.getTime() - rangeStart.getTime()) / span) * plot;

  const ticks: MonthTick[] = [];
  for (let i = 0; i < months; i++) {
    const m = new Date(
      Date.UTC(rangeStart.getUTCFullYear(), rangeStart.getUTCMonth() + i, 1),
    );
    // 次月頭（最終月は rangeEnd = 右端）。ラベルはこの月カラムの中央に置く。
    const next = new Date(
      Date.UTC(rangeStart.getUTCFullYear(), rangeStart.getUTCMonth() + i + 1, 1),
    );
    const x = xOf(m);
    ticks.push({
      x,
      labelX: (x + xOf(next)) / 2,
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
    width: labelWidth + plot + LAYOUT.rightPad,
    height: y,
    labelWidth,
    headerHeight: LAYOUT.headerHeight,
    ticks,
    bands,
    boxes,
    todayX: todayIn ? xOf(today) : null,
  };
}

type Palette = {
  bg: string; band: string; bandAlt: string; grid: string;
  text: string; sub: string; accent: string; accentEdge: string;
  crit: string; critEdge: string; today: string;
};
function palette(scheme: "light" | "dark"): Palette {
  return scheme === "dark"
    ? {
        bg: "#1e1e1e", band: "#262626", bandAlt: "#2d2d2d", grid: "#3a3a3a",
        text: "#e6e6e6", sub: "#9aa0a6", accent: "#256abf",
        accentEdge: "#6ea8fe", crit: "#8a2430", critEdge: "#f06a75",
        today: "#f06a75",
      }
    : {
        bg: "#ffffff", band: "#f4f6fb", bandAlt: "#eef1f8", grid: "#d7dbe6",
        text: "#1f2430", sub: "#5b6472", accent: "#3b6fd6",
        accentEdge: "#2b57ad", crit: "#c93d47", critEdge: "#a3242f",
        today: "#a3242f",
      };
}

function esc(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** name の <br> を tspan 分割して1つの <text> を返す。x はテキスト基準位置。 */
function textLines(
  name: string,
  x: number,
  cy: number,
  anchor: "start" | "middle" | "end",
  cls: string,
): string {
  const lines = name.split(/<br\s*\/?>/i).map((s) => s.trim());
  const lh = 15;
  const top = cy - ((lines.length - 1) * lh) / 2;
  const tspans = lines
    .map(
      (ln, i) =>
        `<tspan x="${x.toFixed(1)}" y="${(top + i * lh).toFixed(1)}">${esc(ln)}</tspan>`,
    )
    .join("");
  return `<text class="${cls}" text-anchor="${anchor}" dominant-baseline="middle">${tspans}</text>`;
}

const FONT = 13;

export function renderScheduleSvg(
  layout: ScheduleLayout,
  scheme: "light" | "dark",
): string {
  const p = palette(scheme);
  const { width, height, labelWidth, headerHeight } = layout;
  const plotWidth = width - labelWidth - LAYOUT.rightPad;
  const parts: string[] = [];

  parts.push(
    `<svg xmlns="http://www.w3.org/2000/svg" ` +
      `viewBox="0 0 ${width} ${height}" width="100%" ` +
      `aria-roledescription="gantt" role="img" ` +
      `font-family="Meiryo UI, Meiryo, sans-serif" font-size="${FONT}">`,
  );

  parts.push(`<style>
    .sched-band { fill: ${p.band}; }
    .sched-band-alt { fill: ${p.bandAlt}; }
    .sched-grid { stroke: ${p.grid}; stroke-width: 1; }
    .sched-tick { fill: ${p.sub}; font-size: 12px; }
    .sched-secname { fill: ${p.text}; font-weight: 600; }
    .sched-task { fill: ${p.accent}; stroke: ${p.accentEdge}; stroke-width: 1; }
    .sched-task.sched-crit { fill: ${p.crit}; stroke: ${p.critEdge}; }
    .sched-label { fill: #ffffff; font-size: ${FONT}px; }
    .sched-label-out { fill: ${p.text}; font-size: ${FONT}px; }
    .sched-mslabel { fill: ${p.text}; font-size: ${FONT}px; }
    .sched-ms { fill: ${p.accentEdge}; }
    .sched-ms.sched-crit { fill: ${p.critEdge}; }
    .sched-today { stroke: ${p.today}; stroke-width: 1.5; stroke-dasharray: 4 3; }
  </style>`);

  parts.push(`<rect x="0" y="0" width="${width}" height="${height}" fill="${p.bg}"/>`);

  // section 帯（交互色）
  layout.bands.forEach((b, i) => {
    parts.push(
      `<rect class="${i % 2 ? "sched-band-alt" : "sched-band"}" x="0" y="${b.y.toFixed(1)}" width="${width}" height="${b.h.toFixed(1)}"/>`,
    );
    parts.push(
      textLines(b.name, 10, b.y + b.h / 2, "start", "sched-secname"),
    );
  });

  // 月次グリッド（線は月境界）＋目盛ラベル（線と線の間＝月カラム中央に置く）
  for (const tick of layout.ticks) {
    parts.push(
      `<line class="sched-grid" x1="${tick.x.toFixed(1)}" y1="${headerHeight}" x2="${tick.x.toFixed(1)}" y2="${height}"/>`,
    );
    parts.push(
      `<text class="sched-tick" x="${tick.labelX.toFixed(1)}" y="${(headerHeight - 14).toFixed(1)}" text-anchor="middle" dominant-baseline="middle">${esc(tick.label)}</text>`,
    );
  }

  // 左ラベルカラムとプロットの境界線
  parts.push(
    `<line class="sched-grid" x1="${labelWidth}" y1="0" x2="${labelWidth}" y2="${height}"/>`,
  );

  // 今日線
  if (layout.todayX !== null) {
    parts.push(
      `<line class="sched-today" x1="${layout.todayX.toFixed(1)}" y1="${headerHeight}" x2="${layout.todayX.toFixed(1)}" y2="${height}"/>`,
    );
  }

  // ボックス（矢羽・マイルストーン）
  for (const box of layout.boxes) {
    const crit = box.isCrit ? " sched-crit" : "";
    if (box.kind === "milestone") {
      const cx = box.x;
      const cy = box.y + box.h / 2;
      const r = 8;
      parts.push(
        `<path class="sched-ms${crit}" d="M ${cx.toFixed(1)} ${(cy - r).toFixed(1)} L ${(cx + r).toFixed(1)} ${cy.toFixed(1)} L ${cx.toFixed(1)} ${(cy + r).toFixed(1)} L ${(cx - r).toFixed(1)} ${cy.toFixed(1)} Z"/>`,
      );
      // ラベルは通常◆の右。右端付近では見切れを避けるため左に反転する。
      const flip = cx > labelWidth + plotWidth * 0.68;
      parts.push(
        flip
          ? textLines(box.label, cx - r - 6, cy, "end", "sched-mslabel")
          : textLines(box.label, cx + r + 6, cy, "start", "sched-mslabel"),
      );
      continue;
    }
    // 矢羽（五角形シェブロン）: 右側が矢尻
    const { x, y, w, h } = box;
    const d = Math.min(12, h / 2, w / 2);
    const pts = [
      [x, y],
      [x + w - d, y],
      [x + w, y + h / 2],
      [x + w - d, y + h],
      [x, y + h],
    ]
      .map(([px, py]) => `${px.toFixed(1)},${py.toFixed(1)}`)
      .join(" ");
    parts.push(`<polygon class="sched-task${crit}" points="${pts}"/>`);
    // ラベルはバーに収まれば内側に白文字。収まらないと白文字が背景に被って
    // 読めなくなるため、バー外に本文色で描く（右端付近は左へ寄せて見切れ防止）。
    const cy = y + h / 2;
    const labelPx = measureLabel(box.label) * FONT;
    const inner = w - d - 12; // 左パディング＋右の矢尻ぶんを除いた実効幅
    if (labelPx <= inner) {
      parts.push(textLines(box.label, x + 8, cy, "start", "sched-label"));
    } else if (x + w + 6 + labelPx <= labelWidth + plotWidth + LAYOUT.rightPad) {
      // バーの右外に置く余地がある
      parts.push(textLines(box.label, x + w + 6, cy, "start", "sched-label-out"));
    } else {
      // 右端に寄っているのでバーの左外へ右寄せで置く
      parts.push(textLines(box.label, x - 6, cy, "end", "sched-label-out"));
    }
  }

  parts.push(`</svg>`);
  return parts.join("\n");
}

export function renderScheduleGanttSvg(
  source: string,
  scheme: "light" | "dark",
): string | null {
  const model = parseGantt(source.trim());
  if (!model) return null;
  const layout = layoutSchedule(model);
  return renderScheduleSvg(layout, scheme);
}
