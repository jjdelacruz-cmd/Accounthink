import { removeFromSection } from "@/app/actions/account";
import { AppShell } from "@/components/AppShell";
import { CourseNav } from "@/components/CourseNav";
import { ResetPasswordButton } from "@/components/ResetPasswordButton";
import { Card } from "@/components/ui";
import { getOwnedCourse } from "@/lib/courses";
import { formatManila } from "@/lib/time";

type Section = {
  id: string;
  name: string;
  join_code: string;
  section_members: {
    joined_at: string;
    profiles: { id: string; full_name: string; student_no: string | null; email: string | null } | null;
  }[];
};

export default async function StudentsPage({ params }: { params: Promise<{ courseId: string }> }) {
  const { courseId } = await params;
  const { profile, supabase, course } = await getOwnedCourse(courseId);
  const { data } = await supabase
    .from("sections")
    .select("id, name, join_code, section_members(joined_at, profiles(id, full_name, student_no, email))")
    .eq("course_id", courseId)
    .order("name");
  const sections = (data ?? []) as unknown as Section[];

  return (
    <AppShell profile={profile}>
      <CourseNav course={course} active="students" />

      {sections.length === 0 && <p className="text-sm text-slate-600">No sections yet. Add one from My courses.</p>}

      {sections.map((s) => {
        const members = s.section_members
          .filter((m) => m.profiles)
          .sort((a, b) => a.profiles!.full_name.localeCompare(b.profiles!.full_name));
        return (
          <Card key={s.id} className="space-y-2 p-0">
            <div className="flex items-center justify-between gap-2 px-4 pt-3">
              <h2 className="font-semibold">
                {s.name} <span className="text-sm font-normal text-slate-500">· {members.length} students</span>
              </h2>
              <span className="rounded-md bg-emerald-50 px-2 py-0.5 font-mono text-sm font-bold tracking-widest text-emerald-800">
                {s.join_code}
              </span>
            </div>
            {members.length === 0 ? (
              <p className="px-4 pb-3 text-sm text-slate-500">No students have joined yet.</p>
            ) : (
              <ul className="divide-y divide-slate-100">
                {members.map((m) => {
                  const p = m.profiles!;
                  return (
                    <li key={p.id} className="flex flex-wrap items-start justify-between gap-2 px-4 py-3">
                      <div className="min-w-0">
                        <p className="truncate font-semibold">{p.full_name || "—"}</p>
                        <p className="truncate text-xs text-slate-500">
                          {[p.student_no, p.email].filter(Boolean).join(" · ")} · joined {formatManila(m.joined_at)}
                        </p>
                      </div>
                      <div className="flex shrink-0 items-start gap-2">
                        <ResetPasswordButton userId={p.id} name={p.full_name || "this student"} />
                        <form action={removeFromSection}>
                          <input type="hidden" name="section_id" value={s.id} />
                          <input type="hidden" name="student_id" value={p.id} />
                          <input type="hidden" name="course_id" value={courseId} />
                          <button className="rounded-lg px-2 py-1 text-xs font-semibold text-red-700">Remove</button>
                        </form>
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </Card>
        );
      })}
    </AppShell>
  );
}
