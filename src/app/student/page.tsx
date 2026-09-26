import { joinSection } from "@/app/actions/student";
import { ActionForm } from "@/components/ActionForm";
import { AppShell } from "@/components/AppShell";
import { Card, Field } from "@/components/ui";
import { requireRole } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";

type Membership = {
  section: {
    id: string;
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
    .select("section:sections(id, name, school_year, semester, course:courses(code, title))")
    .eq("student_id", profile.id);
  const memberships = (data ?? []) as unknown as Membership[];

  return (
    <AppShell profile={profile}>
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
            <p className="mt-2 text-sm text-slate-500">No exams open right now.</p>
          </Card>
        ))
      )}
    </AppShell>
  );
}
