export type MyScore = {
  exam_id: string;
  title: string;
  kind: string;
  status: "published" | "closed";
  course_id: string;
  course_code: string;
  course_title: string;
  section_name: string;
  sort_at: string | null;
  attempt_id: string | null;
  started: boolean;
  submitted_at: string | null;
  end_reason: string | null;
  released: boolean;
  score: number | null;
  max_score: number | null;
  pending: number;
};

export type MyScoreCourse = { code: string; title: string; section: string; rows: MyScore[]; average: number | null };

/** Group by course; the average is the mean percent of the exams whose score the student can see. */
export function groupMyScores(rows: MyScore[]): MyScoreCourse[] {
  const byCourse = new Map<string, MyScoreCourse>();
  for (const r of rows) {
    let c = byCourse.get(r.course_id);
    if (!c) {
      c = { code: r.course_code, title: r.course_title, section: r.section_name, rows: [], average: null };
      byCourse.set(r.course_id, c);
    }
    c.rows.push(r);
  }
  for (const c of byCourse.values()) {
    const shown = c.rows.filter((r) => r.score !== null && r.max_score !== null && Number(r.max_score) > 0);
    c.average = shown.length
      ? shown.reduce((s, r) => s + (Number(r.score) / Number(r.max_score)) * 100, 0) / shown.length
      : null;
  }
  return [...byCourse.values()].sort((a, b) => a.code.localeCompare(b.code));
}
