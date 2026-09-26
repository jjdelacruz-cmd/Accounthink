import { createCourse, createSection, setJoinOpen } from "@/app/actions/instructor";
import { ActionForm } from "@/components/ActionForm";
import { AppShell } from "@/components/AppShell";
import { Card, Field } from "@/components/ui";
import { requireRole } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";

type Section = {
  id: string;
  name: string;
  school_year: string | null;
  semester: string | null;
  join_code: string;
  join_open: boolean;
  section_members: { count: number }[];
};
type Course = { id: string; code: string; title: string; sections: Section[] };

export default async function InstructorHome() {
  const profile = await requireRole("instructor", "admin");
  const supabase = await createClient();
  const { data } = await supabase
    .from("courses")
    .select(
      "id, code, title, sections(id, name, school_year, semester, join_code, join_open, section_members(count))",
    )
    .eq("instructor_id", profile.id)
    .order("code");
  const courses = (data ?? []) as Course[];

  return (
    <AppShell profile={profile}>
      <h1 className="text-xl font-bold">My courses</h1>

      {courses.length === 0 && (
        <p className="text-sm text-slate-600">No courses yet. Add your first one below.</p>
      )}

      {courses.map((course) => (
        <Card key={course.id} className="space-y-3">
          <div>
            <p className="text-sm font-semibold text-emerald-700">{course.code}</p>
            <h2 className="text-lg font-semibold">{course.title}</h2>
          </div>

          {course.sections.length > 0 && (
            <ul className="divide-y divide-slate-100 rounded-xl border border-slate-200">
              {course.sections
                .sort((a, b) => a.name.localeCompare(b.name))
                .map((s) => (
                  <li key={s.id} className="flex flex-wrap items-center justify-between gap-2 p-3">
                    <div>
                      <p className="font-semibold">{s.name}</p>
                      <p className="text-xs text-slate-500">
                        {[s.school_year, s.semester].filter(Boolean).join(" · ") || "—"} ·{" "}
                        {s.section_members[0]?.count ?? 0} students
                      </p>
                    </div>
                    <div className="flex items-center gap-2">
                      <span
                        className={`rounded-lg px-2 py-1 font-mono text-lg font-bold tracking-widest ${
                          s.join_open ? "bg-emerald-50 text-emerald-800" : "bg-slate-100 text-slate-400 line-through"
                        }`}
                        title="Join code"
                      >
                        {s.join_code}
                      </span>
                      <form action={setJoinOpen}>
                        <input type="hidden" name="section_id" value={s.id} />
                        <input type="hidden" name="open" value={String(!s.join_open)} />
                        <button className="rounded-lg border border-slate-300 px-2 py-1 text-xs font-medium">
                          {s.join_open ? "Close joining" : "Open joining"}
                        </button>
                      </form>
                    </div>
                  </li>
                ))}
            </ul>
          )}

          <details className="rounded-xl bg-slate-50 p-3">
            <summary className="cursor-pointer text-sm font-semibold text-slate-700">+ Add section</summary>
            <ActionForm action={createSection} submitLabel="Add section" className="mt-3 space-y-3">
              <input type="hidden" name="course_id" value={course.id} />
              <Field label="Section" name="name" placeholder="e.g. BSA-2Y1-1" required />
              <div className="grid grid-cols-2 gap-3">
                <Field label="School year" name="school_year" placeholder="2026-2027" />
                <Field label="Semester" name="semester" placeholder="1st" />
              </div>
            </ActionForm>
          </details>
        </Card>
      ))}

      <Card>
        <h2 className="mb-3 font-semibold">Add a course</h2>
        <ActionForm action={createCourse} submitLabel="Add course">
          <Field label="Course code" name="code" placeholder="e.g. AUDI314" required />
          <Field label="Course title" name="title" placeholder="e.g. Auditing and Assurance" required />
        </ActionForm>
      </Card>
    </AppShell>
  );
}
