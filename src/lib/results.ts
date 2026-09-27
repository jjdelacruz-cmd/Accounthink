import type { Answer, Choice, ItemType } from "@/lib/items";
import type { MonitorStudent } from "@/lib/monitor";

export type AnalysisItem = {
  position: number;
  item_id: string;
  type: ItemType;
  stem: string;
  choices: Choice[] | null;
  points: number;
  key: Answer | null;
  p: number | null; // share of points earned, 0..1
  n_full: number;
  n_blank: number;
  d: number | null; // discrimination, -1..1 (null if < 4 submissions)
  choice_counts: Record<string, number> | null;
  wrong_answers: { text: string; n: number }[] | null;
};

export type ItemAnalysis = { submitted: number; group_size: number; items: AnalysisItem[] };

export type ReviewItem = {
  index: number;
  item_id: string;
  type: ItemType;
  stem: string;
  points: number;
  choices: Choice[] | null;
  key: Answer | null;
  answer: { choice?: string; text?: string; items?: string[] } | null;
  points_awarded: number | null;
};

export type AttemptReview = {
  attempt: {
    id: string;
    exam_id: string;
    started_at: string;
    submitted_at: string | null;
    end_reason: string | null;
    score: number | null;
    max_score: number | null;
    device: string | null;
  };
  student: { full_name: string; student_no: string | null; email: string | null };
  items: ReviewItem[];
};

export const pct = (score: number, max: number) => (max > 0 ? (score / max) * 100 : 0);
export const round1 = (n: number) => Math.round(n * 10) / 10;

export type ScoreStats = {
  roster: number;
  submitted: number;
  inProgress: number;
  notTaken: number;
  mean: number; // percent
  median: number;
  high: number;
  low: number;
  meanScore: number;
  maxScore: number;
  passed: number | null;
  buckets: number[]; // 10 buckets: 0–9 … 90–100 %
};

export function scoreStats(students: MonitorStudent[], passingPercent: number | null): ScoreStats | null {
  const done = students.filter((s) => s.attempt?.submitted_at);
  const inProgress = students.filter((s) => s.attempt && !s.attempt.submitted_at).length;
  const base = {
    roster: students.length,
    submitted: done.length,
    inProgress,
    notTaken: students.length - done.length - inProgress,
  };
  if (done.length === 0) return null;
  const percents = done.map((s) => pct(Number(s.attempt!.score), Number(s.attempt!.max_score))).sort((a, b) => a - b);
  const mid = Math.floor(percents.length / 2);
  const median = percents.length % 2 ? percents[mid] : (percents[mid - 1] + percents[mid]) / 2;
  const buckets = Array(10).fill(0);
  for (const p of percents) buckets[Math.min(9, Math.floor(p / 10))]++;
  const scores = done.map((s) => Number(s.attempt!.score));
  return {
    ...base,
    mean: percents.reduce((a, b) => a + b, 0) / percents.length,
    median,
    high: percents[percents.length - 1],
    low: percents[0],
    meanScore: scores.reduce((a, b) => a + b, 0) / scores.length,
    maxScore: Number(done[0].attempt!.max_score),
    passed: passingPercent === null ? null : percents.filter((p) => p >= passingPercent).length,
    buckets,
  };
}

// ---------------------------------------------------------------------------
// Item analysis interpretation (common classroom thresholds)
// ---------------------------------------------------------------------------
export function difficultyLabel(p: number | null): string {
  if (p === null) return "—";
  if (p >= 0.8) return "Easy";
  if (p >= 0.3) return "Average";
  return "Difficult";
}

export function discriminationLabel(d: number | null): string {
  if (d === null) return "—";
  if (d < 0) return "Negative";
  if (d >= 0.4) return "Very good";
  if (d >= 0.3) return "Good";
  if (d >= 0.2) return "Fair";
  return "Poor";
}

export type Verdict = { level: "ok" | "revise" | "check"; text: string };

/** One-line recommendation per item. */
export function verdict(it: AnalysisItem): Verdict {
  if (it.d !== null && it.d < 0) {
    return { level: "check", text: "Low scorers did better than high scorers. Check the key or wording." };
  }
  if (it.type === "mcq" && it.key && "correct" in it.key && it.choice_counts) {
    const keyCount = it.choice_counts[it.key.correct] ?? 0;
    const topWrong = Object.entries(it.choice_counts)
      .filter(([k]) => k !== (it.key as { correct: string }).correct)
      .sort((a, b) => b[1] - a[1])[0];
    if (topWrong && topWrong[1] > keyCount) {
      return { level: "check", text: `More students chose ${topWrong[0]} than the key. Check the key.` };
    }
  }
  if (it.p !== null && it.p < 0.2) return { level: "revise", text: "Very few got it. Too hard, unclear, or not taught?" };
  if (it.d !== null && it.d < 0.2) return { level: "revise", text: "Doesn't separate strong from weak students. Revise." };
  if (it.p !== null && it.p > 0.95) return { level: "ok", text: "Almost everyone got it (very easy)." };
  return { level: "ok", text: "Retain." };
}

export function keyText(it: { type: ItemType; key: Answer | null; choices: Choice[] | null }): string {
  const k = it.key;
  if (!k) return "—";
  if ("correct" in k) return `${k.correct}. ${it.choices?.find((c) => c.key === k.correct)?.text ?? ""}`;
  if ("accepted" in k) return k.accepted.join(" / ");
  return `${k.answers.map((a) => a.join(" / ")).join("; ")}${k.any_order ? "" : " (in order)"}`;
}

// ---------------------------------------------------------------------------
// Excel export
// ---------------------------------------------------------------------------
type Cell = { value: string | number | null; fontWeight?: "bold"; type?: StringConstructor | NumberConstructor };

const END_LABEL: Record<string, string> = {
  student: "Submitted",
  timeout: "Time ran out",
  closed: "Exam closed",
  instructor: "Ended by instructor",
  leave_limit: "Auto-submitted (left app)",
};

export function buildWorkbook(
  students: MonitorStudent[],
  analysis: ItemAnalysis,
  passingPercent: number | null,
) {
  const header = (labels: string[]): Cell[] => labels.map((value) => ({ value, fontWeight: "bold" }));
  const num = (n: number | null | undefined): Cell => ({ value: n ?? null, type: Number });
  const str = (s: string | null | undefined): Cell => ({ value: s ?? "", type: String });

  const scoreRows: Cell[][] = [
    header([
      "No.", "Student No.", "Name", "Section", "Score", "Out of", "Percent", ...(passingPercent !== null ? ["Remarks"] : []),
      "Status", "Started (PH)", "Submitted (PH)", "Minutes", "Left app", "Time away (s)", "Copy/paste", "Device/tab flags",
    ]),
  ];
  const fmt = (iso: string | null | undefined) =>
    iso
      ? new Date(iso).toLocaleString("en-PH", { timeZone: "Asia/Manila", dateStyle: "short", timeStyle: "short" })
      : "";
  [...students]
    .sort((a, b) => a.full_name.localeCompare(b.full_name))
    .forEach((s, i) => {
      const a = s.attempt;
      const done = !!a?.submitted_at;
      const percent = done ? round1(pct(Number(a!.score), Number(a!.max_score))) : null;
      scoreRows.push([
        num(i + 1),
        str(s.student_no),
        str(s.full_name),
        str(s.section),
        num(done ? Number(a!.score) : null),
        num(done ? Number(a!.max_score) : null),
        num(percent),
        ...(passingPercent !== null
          ? [str(percent === null ? "" : percent >= passingPercent ? "Passed" : "Failed")]
          : []),
        str(!a ? "Did not take" : done ? (END_LABEL[a.end_reason ?? "student"] ?? a.end_reason) : "In progress"),
        str(fmt(a?.started_at)),
        str(fmt(a?.submitted_at)),
        num(done ? round1((Date.parse(a!.submitted_at!) - Date.parse(a!.started_at)) / 60000) : null),
        num(a?.leaves ?? null),
        num(a?.away_seconds ?? null),
        num(a?.copy_paste ?? null),
        num(a?.device_flags ?? null),
      ]);
    });

  const letters = ["A", "B", "C", "D", "E", "F"];
  const itemRows: Cell[][] = [
    header(["No.", "Question", "Type", "Points", "Key", "% correct", "Difficulty", "Discrimination (D)", "D rating",
      "Blank", ...letters.map((l) => `Chose ${l}`), "Recommendation"]),
  ];
  analysis.items.forEach((it, i) => {
    itemRows.push([
      num(i + 1),
      str(it.stem),
      str(it.type === "mcq" ? "Multiple choice" : it.type === "identification" ? "Identification" : "Enumeration"),
      num(Number(it.points)),
      str(keyText(it)),
      num(it.p === null ? null : round1(it.p * 100)),
      str(difficultyLabel(it.p)),
      num(it.d === null ? null : Math.round(it.d * 100) / 100),
      str(discriminationLabel(it.d)),
      num(it.n_blank),
      ...letters.map((l) => num(it.choice_counts ? (it.choice_counts[l] ?? (it.choices?.some((c) => c.key === l) ? 0 : null)) : null)),
      str(verdict(it).text),
    ]);
  });

  return [
    {
      sheet: "Scores",
      data: scoreRows,
      stickyRowsCount: 1,
      columns: [{ width: 5 }, { width: 14 }, { width: 28 }, { width: 12 }, { width: 8 }, { width: 8 }, { width: 9 },
        ...(passingPercent !== null ? [{ width: 9 }] : []),
        { width: 22 }, { width: 18 }, { width: 18 }, { width: 9 }, { width: 9 }, { width: 12 }, { width: 11 }, { width: 14 }],
    },
    {
      sheet: "Item analysis",
      data: itemRows,
      stickyRowsCount: 1,
      columns: [{ width: 5 }, { width: 50 }, { width: 15 }, { width: 7 }, { width: 28 }, { width: 10 }, { width: 11 },
        { width: 16 }, { width: 11 }, { width: 7 }, ...letters.map(() => ({ width: 9 })), { width: 50 }],
    },
  ] as const;
}

/** File-name-safe text: some browsers reject names with em dashes or smart quotes. */
export function safeFileName(s: string) {
  return (
    s
      .replace(/[\u2012-\u2015]/g, "-") // en/em dashes
      .replace(/[\u2018\u2019]/g, "'")
      .replace(/[\u201c\u201d]/g, "")
      .normalize("NFKD")
      .replace(/[^\x20-\x7e]/g, "") // ñ -> n, drop other non-ASCII
      .replace(/[\\/:*?"<>|]+/g, "-")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 80) || "results"
  );
}
