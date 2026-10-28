import Link from "next/link";
import { joinSection } from "@/app/actions/student";
import { ActionForm } from "@/components/ActionForm";
import { AppShell } from "@/components/AppShell";
import { InstallPrompt } from "@/components/InstallPrompt";
import { ScoreUpdates, type ScoreUpdate } from "@/components/ScoreUpdates";
import { Icon } from "@/components/icons";
import { Badge, Card, EmptyState, Field, PageTitle, SectionTitle } from "@/components/ui";
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

  // Scores that changed since the student last dismissed the notice (only for exams whose scores they can see).
  const { data: updateData } = await supabase.rpc("my_score_updates");
  const scoreUpdates = (updateData ?? []) as ScoreUpdate[];

  // RLS returns only announcements for the student's own sections.
  const { data: annData } = await supabase
    .from("announcements")
    .select("id, title, body, created_at, courses(code)")
    .order("created_at", { ascending: false })
    .limit(5);
  const announcements = (annData ?? []) as unknown as {
    id: string;
    title: string;
    body: string;
    created_at: string;
    courses: { code: string } | null;
  }[];

  return (
    <AppShell profile={profile}>
      <InstallPrompt />
      <ScoreUpdates updates={scoreUpdates} />
      {announcements.length > 0 && (
        <section className="space-y-2" aria-label="Announcements">
          <SectionTitle>Announcements</SectionTitle>
          {announcements.map((a) => (
            <details key={a.id} className="group rounded-card border border-brand-200 bg-brand-50 p-3 open:bg-white">
              <summary className="flex cursor-pointer list-none items-start gap-3 [&::-webkit-details-marker]:hidden">
                <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-brand-100 text-brand-800">
                  <Icon name="megaphone" size={16} />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block font-semibold">{a.title}</span>
                  <span className="block text-xs text-ink-600">
                    {a.courses?.code} · {formatManila(a.created_at)}
                  </span>
                </span>
                <Icon name="chevron-down" size={18} className="mt-1.5 text-ink-500 group-open:rotate-180" />
              </summary>
              <p className="mt-2 whitespace-pre-line pl-11 text-sm text-ink-800">{a.body}</p>
            </details>
          ))}
        </section>
      )}
      <Card>
        <SectionTitle className="mb-3">Join a class</SectionTitle>
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

      <PageTitle>My classes</PageTitle>
      {memberships.length === 0 ? (
        <EmptyState icon="users" title="No classes yet">
          You haven&apos;t joined any class yet.
        </EmptyState>
      ) : (
        memberships.map(({ section: s }) => (
          <Card key={s.id}>
            <p className="text-sm font-semibold text-brand-700">{s.course.code}</p>
            <h2 className="text-heading font-semibold">{s.course.title}</h2>
            <p className="text-sm text-ink-600">
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
  if (exams.length === 0) return <p className="mt-3 rounded-control bg-ink-50 px-3 py-2 text-sm text-ink-600">No exams yet.</p>;
  return (
    <ul className="mt-3 space-y-2">
      {exams.map((e) => (
        <li key={e.id}>
          <Link href={`/student/exams/${e.id}`} className="row-link">
            <div className="flex items-start justify-between gap-2">
              <p className="font-semibold">{e.title}</p>
              <Badge tone={e.status === "published" ? "success" : "neutral"} className="shrink-0">
                {e.status === "published" ? "Open" : "Closed"}
              </Badge>
            </div>
            <p className="mt-0.5 text-xs text-ink-600">
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
