/**
 * 依存なしの行単位 diff（チャットの編集提案プレビュー用）。
 * 共通の先頭/末尾行をトリムしてから Myers O(ND) を回す。
 * 差分が大きすぎる場合は null を返し、呼び出し側は
 * 「文書全体が置き換わります」表示にフォールバックする。
 */

export type DiffLine = {
  kind: "same" | "add" | "del" | "skip";
  text: string;
};

/** Myers の探索距離の上限。超えたら null（全文置換扱い）。 */
const MAX_D = 1000;

function splitLines(text: string): string[] {
  // 末尾改行の有無で余計な空行差分を出さないため、改行「区切り」で分割する。
  const lines = text.split("\n");
  if (lines.length > 0 && lines[lines.length - 1] === "") lines.pop();
  return lines;
}

/**
 * Myers O(ND) で a → b の編集スクリプトを求める。
 * 返り値は del/add/same の並び。d > maxD なら null。
 */
function myersDiff(a: string[], b: string[], maxD: number): DiffLine[] | null {
  const n = a.length;
  const m = b.length;
  const max = Math.min(n + m, maxD);
  const offset = max;
  // 各 d の V 配列スナップショット（バックトラック用）
  const trace: Int32Array[] = [];
  let v = new Int32Array(2 * max + 2);

  let found = -1;
  outer: for (let d = 0; d <= max; d++) {
    trace.push(v.slice());
    const next = v.slice();
    for (let k = -d; k <= d; k += 2) {
      let x: number;
      if (k === -d || (k !== d && v[offset + k - 1] < v[offset + k + 1])) {
        x = v[offset + k + 1]; // 下から（b を1つ進める = add）
      } else {
        x = v[offset + k - 1] + 1; // 右へ（a を1つ進める = del）
      }
      let y = x - k;
      while (x < n && y < m && a[x] === b[y]) {
        x++;
        y++;
      }
      next[offset + k] = x;
      if (x >= n && y >= m) {
        v = next;
        trace.push(v.slice());
        found = d;
        break outer;
      }
    }
    v = next;
  }
  if (found < 0) return null;

  // バックトラックして編集列を復元する
  const out: DiffLine[] = [];
  let x = n;
  let y = m;
  for (let d = found; d > 0; d--) {
    const pv = trace[d]; // d-1 終了時点の V
    const k = x - y;
    let prevK: number;
    if (k === -d || (k !== d && pv[offset + k - 1] < pv[offset + k + 1])) {
      prevK = k + 1; // add で来た
    } else {
      prevK = k - 1; // del で来た
    }
    const prevX = pv[offset + prevK];
    const prevY = prevX - prevK;
    // 対角（共通行）を戻す
    while (x > prevX && y > prevY && x > 0 && y > 0) {
      out.push({ kind: "same", text: a[x - 1] });
      x--;
      y--;
    }
    if (prevK === k + 1) {
      out.push({ kind: "add", text: b[y - 1] });
      y--;
    } else {
      out.push({ kind: "del", text: a[x - 1] });
      x--;
    }
  }
  while (x > 0 && y > 0) {
    out.push({ kind: "same", text: a[x - 1] });
    x--;
    y--;
  }
  out.reverse();
  return out;
}

/**
 * 行単位の diff を返す。差分が大きすぎる場合は null。
 */
export function diffLines(oldText: string, newText: string): DiffLine[] | null {
  const a = splitLines(oldText);
  const b = splitLines(newText);

  // 共通の先頭行をトリム
  let start = 0;
  while (start < a.length && start < b.length && a[start] === b[start]) start++;
  // 共通の末尾行をトリム（先頭トリム分と重ならない範囲で）
  let endA = a.length;
  let endB = b.length;
  while (endA > start && endB > start && a[endA - 1] === b[endB - 1]) {
    endA--;
    endB--;
  }

  const midA = a.slice(start, endA);
  const midB = b.slice(start, endB);
  const mid = myersDiff(midA, midB, MAX_D);
  if (mid === null) return null;

  const head: DiffLine[] = a
    .slice(0, start)
    .map((text) => ({ kind: "same" as const, text }));
  const tail: DiffLine[] = a
    .slice(endA)
    .map((text) => ({ kind: "same" as const, text }));
  return [...head, ...mid, ...tail];
}

/**
 * 連続する same 行を前後 context 行だけ残して "skip" 1行（省略行数入り）に畳む。
 * 差分の先頭側/末尾側の same 連続はそれぞれ片側 context 行だけ残す。
 */
export function foldContext(lines: DiffLine[], context = 2): DiffLine[] {
  const out: DiffLine[] = [];
  let i = 0;
  while (i < lines.length) {
    if (lines[i].kind !== "same") {
      out.push(lines[i]);
      i++;
      continue;
    }
    let j = i;
    while (j < lines.length && lines[j].kind === "same") j++;
    const run = lines.slice(i, j);
    const atStart = i === 0;
    const atEnd = j === lines.length;
    // 保持する行数: 中間は前後 context ずつ、端は片側のみ
    const keepBefore = atStart ? 0 : context;
    const keepAfter = atEnd ? 0 : context;
    if (run.length <= keepBefore + keepAfter + 1) {
      out.push(...run);
    } else {
      out.push(...run.slice(0, keepBefore));
      const skipped = run.length - keepBefore - keepAfter;
      out.push({ kind: "skip", text: `… ${skipped} …` });
      out.push(...run.slice(run.length - keepAfter));
    }
    i = j;
  }
  return out;
}
