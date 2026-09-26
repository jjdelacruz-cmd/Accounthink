import Link from "next/link";
import { createExam } from "@/app/actions/exams";
import { ActionForm } from "@/components/ActionForm";
import { AppShell } from "@/components/AppShell";
import { CourseNav } from "@/components/CourseNav";
import { ExamStatusBadge } from "@/components/ExamStatusBadge";
import { Card, Field } from "@/components/ui";
import { getOwnedCourse } from "@/lib/courses";
import { KIND_LABEL } from "@/lib/exams";
import { formatManila } from "@/lib/time";

type ExamRow = {
  id: string;
  title: string;
  kind: string;
  status: "draft" | "published" | "closed";
  time_limit_minutes: number | null;
  opens_at: string | null;
  closes_at: string | null;
  exam_items: { count: number }[];
  exam_sections: { sections: { name: string } | null }[];
};

export default async function ExamsPage({ params }: { params: Promise<{ courseId: string }> }) {
  const { courseId } = await params;
  const { profile, supabase, course } = await getOwnedCourse(courseId);

  const { data } = await supabase
    .from("exams")
    .select(
      "id, title, kind, status, time_limit_minutes, opens_at, closes_at, exam_items(count), exam_sections(sections(name))",
    )
    .eq("course_id", courseId)
    .order("created_at", { ascending: false });
  const exams = (data ?? []) as unknown as ExamRow[];

  return (
    <AppShell profile={profile}>
      <CourseNav course={course} active="exams" />

      <Card>
        <h2 className="mb-3 font-semibold">New exam</h2>
        <ActionForm action={createExam} submitLabel="Create exam" pendingLabel="Creating…">
          <input type="hidden" name="course_id" value={courseId} />
          <Field label="Title" name="title" placeholder="e.g. Quiz 1 — Audit evidence" required />
          <label className="block">
            <span className="mb-1 block text-sm font-medium text-slate-700">Type</span>
            <select name="kind" className="block w-full rounded-xl border border-slate-300 bg-white px-3 py-3">
              {Object.entries(KIND_LABEL).map(([v, l]) => (
                <option key={v} value={v}>{l}</option>
              ))}
            </select>
          </label>
        </ActionForm>
      </Card>

      {exams.length === 0 && <p className="text-sm text-slate-600">No exams yet.</p>}

      {exams.map((e) => (
        <Link key={e.id} href={`/instructor/courses/${courseId}/exams/${e.id}`} className="block">
          <Card className="space-y-1 hover:border-emerald-300">
            <div className="flex items-start justify-between gap-2">
              <div>
                <p className="text-xs font-semibold uppercase text-slate-500">{KIND_LABEL[e.kind] ?? e.kind}</p>
                <p className="font-semibold">{e.title}</p>
              </div>
              <ExamStatusBadge status={e.status} />
            </div>
            <p className="text-sm text-slate-600">
              {e.exam_items[0]?.count ?? 0} items
              {e.time_limit_minutes ? ` · ${e.time_limit_minutes} min` : ""}
              {e.exam_sections.length
                ? ` · ${e.exam_sections.map((s) => s.sections?.name).filter(Boolean).join(", ")}`
                : " · no sections"}
            </p>
            {(e.opens_at || e.closes_at) && (
              <p className="text-xs text-slate-500">
                {formatManila(e.opens_at)} → {formatManila(e.closes_at)}
              </p>
            )}
          </Card>
        </Link>
      ))}
    </AppShell>
  );
}
