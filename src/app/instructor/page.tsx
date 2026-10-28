import { createCourse, createSection, setJoinOpen } from "@/app/actions/instructor";
import { ActionForm } from "@/components/ActionForm";
import { DownloadAllGradebooks } from "@/components/DownloadGradebook";
import { AppShell } from "@/components/AppShell";
import { Button, Card, EmptyState, Field, LinkButton, PageTitle, SectionTitle } from "@/components/ui";
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
      <PageTitle
        actions={
          profile.role === "admin" && (
            <LinkButton href="/admin" variant="secondary" size="sm" icon="users">
              Manage users
            </LinkButton>
          )
        }
      >
        My courses
      </PageTitle>

      {courses.length > 0 && <DownloadAllGradebooks className="sm:w-fit" />}

      {courses.length === 0 && (
        <EmptyState icon="layers" title="No courses yet">
          Add your first one below.
        </EmptyState>
      )}

      {courses.map((course) => (
        <Card key={course.id} className="space-y-4">
          <div>
            <p className="text-sm font-semibold text-brand-700">{course.code}</p>
            <h2 className="text-heading font-semibold">{course.title}</h2>
          </div>

          <div className="grid grid-cols-3 gap-2">
            <LinkButton href={`/instructor/courses/${course.id}/items`} variant="secondary" size="sm" icon="layers" className="min-h-12">
              Items
            </LinkButton>
            <LinkButton href={`/instructor/courses/${course.id}/exams`} size="sm" icon="clipboard" className="min-h-12">
              Exams
            </LinkButton>
            <LinkButton href={`/instructor/courses/${course.id}/scores`} variant="secondary" size="sm" icon="chart" className="min-h-12">
              Scores
            </LinkButton>
          </div>

          {course.sections.length > 0 && (
            <ul className="list">
              {course.sections
                .sort((a, b) => a.name.localeCompare(b.name))
                .map((s) => (
                  <li key={s.id} className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2 p-3">
                    <div className="min-w-0">
                      <p className="font-semibold">{s.name}</p>
                      <p className="text-xs text-ink-600">
                        {[s.school_year, s.semester].filter(Boolean).join(" · ") || "—"} ·{" "}
                        {s.section_members[0]?.count ?? 0} students
                      </p>
                    </div>
                    <div className="flex items-center gap-2">
                      <span
                        className={`rounded-chip px-2.5 py-1 font-mono text-lg font-bold tracking-widest ${
                          s.join_open ? "bg-brand-50 text-brand-800" : "bg-ink-100 text-ink-500 line-through"
                        }`}
                        title="Join code"
                      >
                        {s.join_code}
                      </span>
                      <form action={setJoinOpen}>
                        <input type="hidden" name="section_id" value={s.id} />
                        <input type="hidden" name="open" value={String(!s.join_open)} />
                        <Button variant="secondary" size="sm">
                          {s.join_open ? "Close joining" : "Open joining"}
                        </Button>
                      </form>
                    </div>
                  </li>
                ))}
            </ul>
          )}

          <details className="group rounded-control bg-ink-50 p-3">
            <summary className="flex cursor-pointer list-none items-center gap-1.5 text-sm font-semibold text-brand-800 [&::-webkit-details-marker]:hidden">
              + Add section
            </summary>
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
        <SectionTitle className="mb-3">Add a course</SectionTitle>
        <ActionForm action={createCourse} submitLabel="Add course">
          <Field label="Course code" name="code" placeholder="e.g. AUDI314" required />
          <Field label="Course title" name="title" placeholder="e.g. Auditing and Assurance" required />
        </ActionForm>
      </Card>
    </AppShell>
  );
}
