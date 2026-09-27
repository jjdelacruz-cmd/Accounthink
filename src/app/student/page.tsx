import Link from "next/link";
import { joinSection } from "@/app/actions/student";
import { ActionForm } from "@/components/ActionForm";
import { AppShell } from "@/components/AppShell";
import { InstallPrompt } from "@/components/InstallPrompt";
import { Card, Field } from "@/components/ui";
import { requireRole } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { formatManila } from "@/lib/time";

type StudentExam = {
  id: string;
  title: string;
  course_id: string;
  status: "published" | "closed";
  time_limit_minutes: number | null;
  opens_at: string | null;
  closes_at: string | null;
};

type Membership = {
  section: {
    id: string;
    course_id: string;
    name: string;
    school_year: string | null;
    semester: string | null;
    course: { code: string; title: string };
  };
};

export default async function StudentHome() {
  const profile = await requireRole("student");
  const supabase = await createClient();
  const { data } = await supabase
    .from("section_members")
    .select("section:sections(id, course_id, name, school_year, semester, course:courses(code, title))")
    .eq("student_id", profile.id);
  const memberships = (data ?? []) as unknown as Membership[];

  // RLS only returns published/closed exams assigned to this student's sections.
  const { data: examData } = await supabase
    .from("exams")
    .select("id, title, course_id, status, time_limit_minutes, opens_at, closes_at")
    .neq("status", "draft")
    .order("opens_at", { ascending: true, nullsFirst: false });
  const exams = (examData ?? []) as StudentExam[];

  return (
    <AppShell profile={profile}>
      <InstallPrompt />
      <Card>
        <h2 className="mb-3 font-semibold">Join a class</h2>
        <ActionForm action={joinSection} submitLabel="Join" pendingLabel="Joining…">
          <Field
            label="Join code from your instructor"
            name="code"
            autoCapitalize="characters"
            autoComplete="off"
            maxLength={6}
            placeholder="ABC123"
            className="font-mono uppercase tracking-widest"
            required
          />
        </ActionForm>
      </Card>

      <h1 className="text-xl font-bold">My classes</h1>
      {memberships.length === 0 ? (
        <p className="text-sm text-slate-600">You haven&apos;t joined any class yet.</p>
      ) : (
        memberships.map(({ section: s }) => (
          <Card key={s.id}>
            <p className="text-sm font-semibold text-emerald-700">{s.course.code}</p>
            <p className="font-semibold">{s.course.title}</p>
            <p className="text-sm text-slate-500">
              {s.name}
              {s.school_year ? ` · ${s.school_year}` : ""}
              {s.semester ? ` · ${s.semester} sem` : ""}
            </p>
            <ExamList exams={exams.filter((e) => e.course_id === s.course_id)} />
          </Card>
        ))
      )}
    </AppShell>
  );
}

function ExamList({ exams }: { exams: StudentExam[] }) {
  if (exams.length === 0) return <p className="mt-2 text-sm text-slate-500">No exams yet.</p>;
  return (
    <ul className="mt-3 space-y-2">
      {exams.map((e) => (
        <li key={e.id}>
          <Link href={`/student/exams/${e.id}`} className="block rounded-xl border border-slate-200 p-3 hover:border-emerald-300">
          <div className="flex items-start justify-between gap-2">
            <p className="font-semibold">{e.title}</p>
            <span
              className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-semibold ${
                e.status === "published" ? "bg-emerald-100 text-emerald-800" : "bg-slate-100 text-slate-600"
              }`}
            >
              {e.status === "published" ? "Open" : "Closed"}
            </span>
          </div>
          <p className="text-xs text-slate-500">
            {e.time_limit_minutes ? `${e.time_limit_minutes} min` : ""}
            {e.opens_at ? ` · opens ${formatManila(e.opens_at)}` : ""}
            {e.closes_at ? ` · closes ${formatManila(e.closes_at)}` : ""}
          </p>
          </Link>
        </li>
      ))}
    </ul>
  );
}
