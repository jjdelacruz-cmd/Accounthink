import { KIND_LABEL } from "@/lib/exams";
import { round1 } from "@/lib/results";

// ---------------------------------------------------------------------------
// Data from course_gradebook()
// ---------------------------------------------------------------------------
export type GbExam = {
  id: string;
  title: string;
  kind: string;
  status: "published" | "closed";
  opens_at: string | null;
  passing_percent: number | null;
  max: number;
  section_ids: string[];
};

export type GbScore = { score: number | null; max: number | null; submitted: boolean; pending: number };

export type GbStudent = {
  student_id: string;
  full_name: string;
  student_no: string | null;
  section_id: string;
  section_name: string;
  scores: Record<string, GbScore>;
};

export type Gradebook = {
  course: { code: string; title: string };
  exams: GbExam[];
  sections: { id: string; name: string }[];
  students: GbStudent[];
};

// ---------------------------------------------------------------------------
// Calculations (shared by the on-screen table and the Excel file)
// ---------------------------------------------------------------------------
/** done = submitted; absent = given to the student's section but not taken; progress = started, not submitted. */
export type CellState =
  | { kind: "done"; score: number; max: number; pending: number }
  | { kind: "absent" }
  | { kind: "progress" }
  | { kind: "na" };

export function cellFor(s: GbStudent, e: GbExam): CellState {
  const a = s.scores[e.id];
  if (a?.submitted) return { kind: "done", score: Number(a.score ?? 0), max: Number(a.max ?? e.max), pending: Number(a.pending ?? 0) };
  if (a) return { kind: "progress" };
  return e.section_ids.includes(s.section_id) ? { kind: "absent" } : { kind: "na" };
}

export type RowTotals = { earned: number; possible: number; percent: number | null; taken: number; assigned: number };

/** Total = points earned; Out of = points of every exam given to the student (absent counts as 0). */
export function totalsFor(s: GbStudent, exams: GbExam[]): RowTotals {
  let earned = 0;
  let possible = 0;
  let taken = 0;
  let assigned = 0;
  for (const e of exams) {
    const c = cellFor(s, e);
    if (c.kind === "na") continue;
    assigned++;
    possible += c.kind === "done" ? c.max : e.max;
    if (c.kind === "done") {
      earned += c.score;
      taken++;
    }
  }
  return { earned, possible, percent: possible > 0 ? round1((earned / possible) * 100) : null, taken, assigned };
}

export type ExamStats = { took: number; assigned: number; average: number | null; high: number | null; low: number | null };

export function examStats(students: GbStudent[], e: GbExam): ExamStats {
  const scores: number[] = [];
  let assigned = 0;
  for (const s of students) {
    const c = cellFor(s, e);
    if (c.kind === "na") continue;
    assigned++;
    if (c.kind === "done") scores.push(c.score);
  }
  const avg = scores.length ? scores.reduce((a, b) => a + b, 0) / scores.length : null;
  return {
    took: scores.length,
    assigned,
    average: avg === null ? null : round1(avg),
    high: scores.length ? Math.max(...scores) : null,
    low: scores.length ? Math.min(...scores) : null,
  };
}

/** Students of one section, or everyone, sorted by name. */
export function studentsOf(book: Gradebook, sectionId?: string | null): GbStudent[] {
  return book.students
    .filter((s) => !sectionId || s.section_id === sectionId)
    .sort((a, b) => a.full_name.localeCompare(b.full_name) || a.section_name.localeCompare(b.section_name));
}

/** Only the exams given to at least one of these students' sections (or that they have an attempt in). */
export function examsFor(book: Gradebook, students: GbStudent[]): GbExam[] {
  return book.exams.filter((e) => students.some((s) => cellFor(s, e).kind !== "na"));
}

// ---------------------------------------------------------------------------
// Excel
// ---------------------------------------------------------------------------
type Cell = {
  value: string | number | null;
  type?: StringConstructor | NumberConstructor;
  fontWeight?: "bold";
  fontStyle?: "italic";
  backgroundColor?: string;
  textColor?: string;
  align?: "left" | "center" | "right";
  alignVertical?: "top" | "center" | "bottom";
  wrap?: boolean;
  format?: string;
};

const AMBER = "#FEF3C7"; // some answers still waiting to be checked
const HEAD = "#ECFDF5";
const RED_TEXT = "#B91C1C";
const GREY_TEXT = "#64748B";

const str = (s: string | null | undefined, extra: Partial<Cell> = {}): Cell => ({ value: s ?? "", type: String, ...extra });
const num = (n: number | null | undefined, extra: Partial<Cell> = {}): Cell => ({ value: n ?? null, type: Number, ...extra });
const head = (s: string, extra: Partial<Cell> = {}): Cell => ({
  value: s, type: String, fontWeight: "bold", backgroundColor: HEAD, wrap: true, alignVertical: "center", ...extra,
});

function fmtDate(iso: string | null) {
  return iso ? new Date(iso).toLocaleString("en-PH", { timeZone: "Asia/Manila", dateStyle: "medium", timeStyle: "short" }) : "";
}

/** Excel sheet names: up to 31 characters, none of : \ / ? * [ ], and unique within the file. */
function sheetNamer() {
  const used = new Set<string>();
  return (raw: string) => {
    const base = raw.replace(/[:\\/?*[\]]/g, "-").replace(/\s+/g, " ").trim().slice(0, 31) || "Sheet";
    let name = base;
    for (let i = 2; used.has(name.toLowerCase()); i++) {
      const suffix = ` (${i})`;
      name = base.slice(0, 31 - suffix.length) + suffix;
    }
    used.add(name.toLowerCase());
    return name;
  };
}

function scoreSheet(book: Gradebook, students: GbStudent[], withSection: boolean) {
  const exams = examsFor(book, students);
  const lead = withSection ? 4 : 3;
  const header: Cell[] = [
    head("No."),
    head("Student No."),
    head("Name"),
    ...(withSection ? [head("Section")] : []),
    ...exams.map((e) => head(`${e.title}\n(${e.max} pts)`, { align: "center" })),
    head("Total", { align: "center" }),
    head("Out of", { align: "center" }),
    head("Overall %", { align: "center" }),
    head("Exams taken", { align: "center" }),
  ];
  const rows: Cell[][] = [header];
  students.forEach((s, i) => {
    const t = totalsFor(s, exams);
    rows.push([
      num(i + 1),
      str(s.student_no),
      str(s.full_name),
      ...(withSection ? [str(s.section_name)] : []),
      ...exams.map((e): Cell => {
        const c = cellFor(s, e);
        if (c.kind === "done") return num(c.score, { align: "center", ...(c.pending > 0 ? { backgroundColor: AMBER } : {}) });
        if (c.kind === "absent") return str("ABS", { align: "center", textColor: RED_TEXT });
        if (c.kind === "progress") return str("in progress", { align: "center", fontStyle: "italic", textColor: GREY_TEXT });
        return str("", { align: "center" });
      }),
      num(t.assigned ? t.earned : null, { align: "center", fontWeight: "bold" }),
      num(t.assigned ? t.possible : null, { align: "center" }),
      num(t.percent, { align: "center", fontWeight: "bold", format: "0.0" }),
      str(t.assigned ? `${t.taken}/${t.assigned}` : "", { align: "center" }),
    ]);
  });
  // Class figures under the table.
  const blank = (): Cell => str("");
  const footer = (label: string, f: (e: GbExam) => Cell) => [
    ...Array.from({ length: lead - 1 }, blank),
    str(label, { fontWeight: "bold", align: "right" }),
    ...exams.map(f),
  ];
  rows.push([]);
  rows.push(footer("Average (of those who took it)", (e) => num(examStats(students, e).average, { align: "center", format: "0.0" })));
  rows.push(footer("Took it", (e) => { const x = examStats(students, e); return str(`${x.took}/${x.assigned}`, { align: "center" }); }));
  rows.push(footer("Highest", (e) => num(examStats(students, e).high, { align: "center" })));
  rows.push(footer("Lowest", (e) => num(examStats(students, e).low, { align: "center" })));

  return {
    data: rows,
    stickyRowsCount: 1,
    stickyColumnsCount: lead,
    columns: [
      { width: 5 }, { width: 14 }, { width: 28 }, ...(withSection ? [{ width: 12 }] : []),
      ...exams.map(() => ({ width: 15 })), { width: 9 }, { width: 9 }, { width: 11 }, { width: 12 },
    ],
  };
}

function examsSheet(books: Gradebook[]) {
  const header = ["No.", ...(books.length > 1 ? ["Subject"] : []), "Exam", "Type", "Status", "Opens (PH time)", "Points", "Sections",
    "Took it", "Average", "Highest", "Lowest", "Passing %"].map((h) => head(h));
  const rows: Cell[][] = [header];
  let n = 0;
  for (const book of books) {
    for (const e of book.exams) {
      const st = examStats(book.students, e);
      const names = book.sections.filter((s) => e.section_ids.includes(s.id)).map((s) => s.name).join(", ");
      rows.push([
        num(++n),
        ...(books.length > 1 ? [str(book.course.code)] : []),
        str(e.title),
        str(KIND_LABEL[e.kind] ?? e.kind),
        str(e.status === "closed" ? "Closed" : "Open"),
        str(fmtDate(e.opens_at)),
        num(e.max),
        str(names),
        str(`${st.took}/${st.assigned}`, { align: "center" }),
        num(st.average, { format: "0.0" }),
        num(st.high),
        num(st.low),
        num(e.passing_percent),
      ]);
    }
  }
  return {
    data: rows,
    stickyRowsCount: 1,
    columns: [{ width: 5 }, ...(books.length > 1 ? [{ width: 12 }] : []), { width: 30 }, { width: 11 }, { width: 9 }, { width: 20 },
      { width: 8 }, { width: 22 }, { width: 9 }, { width: 9 }, { width: 9 }, { width: 9 }, { width: 10 }],
  };
}

function notesSheet(generatedBy: string) {
  const lines = [
    "Accounthink scores",
    `Downloaded ${new Date().toLocaleString("en-PH", { timeZone: "Asia/Manila", dateStyle: "long", timeStyle: "short" })} (PH time)${generatedBy ? ` by ${generatedBy}` : ""}`,
    "",
    "How to read the score sheets",
    "• Each cell is the points a student earned in that exam. The exam's total points are in the column heading.",
    "• ABS = the exam was given to the student's section but the student did not take it (counts as 0 in Out of / Overall %).",
    "• in progress = the student started but has not submitted yet.",
    "• A blank cell = the exam was not given to that student's section.",
    "• Amber cells = some answers (for example an essay) are still waiting to be checked, so the score may go up.",
    "• Total = points earned. Out of = points of every exam given to that student's section. Overall % = Total ÷ Out of.",
    "• Average, Highest and Lowest only count students who took the exam.",
    "• These are the scores at the time of download. Re-download to get changes.",
  ];
  return {
    data: lines.map((l, i) => [str(l, { fontWeight: i === 0 || l === "How to read the score sheets" ? "bold" : undefined, wrap: false })]),
    columns: [{ width: 110 }],
  };
}

/**
 * The gradebook workbook: per subject, one sheet with everyone and one sheet per section (each with
 * the class average under the table), then an Exams sheet and a Notes sheet.
 * Pass sectionId to get just one section of a single subject.
 */
export function buildGradebookWorkbook(books: Gradebook[], opts: { sectionId?: string | null; generatedBy?: string } = {}) {
  const name = sheetNamer();
  const sheets: { sheet: string; [k: string]: unknown }[] = [];
  const multi = books.length > 1;
  // The Exams sheet only counts the students that are in the file.
  const examBooks: Gradebook[] = [];
  for (const book of books) {
    const students = studentsOf(book, opts.sectionId);
    examBooks.push({ ...book, students, exams: examsFor(book, students) });
  }
  for (const book of books) {
    const prefix = multi ? `${book.course.code} ` : "";
    if (opts.sectionId) {
      const sec = book.sections.find((s) => s.id === opts.sectionId);
      sheets.push({ sheet: name(`${prefix}${sec?.name ?? "Section"}`), ...scoreSheet(book, studentsOf(book, opts.sectionId), false) });
      continue;
    }
    sheets.push({ sheet: name(`${prefix}All sections`), ...scoreSheet(book, studentsOf(book), true) });
    if (book.sections.length > 1) {
      for (const sec of book.sections) {
        const list = studentsOf(book, sec.id);
        if (list.length) sheets.push({ sheet: name(`${prefix}${sec.name}`), ...scoreSheet(book, list, false) });
      }
    }
  }
  sheets.push({ sheet: name("Exams"), ...examsSheet(examBooks) });
  sheets.push({ sheet: name("Notes"), ...notesSheet(opts.generatedBy ?? "") });
  return sheets;
}
