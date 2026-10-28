import Link from "next/link";
import { removeFromSection } from "@/app/actions/account";
import { AppShell } from "@/components/AppShell";
import { Avatar } from "@/components/Avatar";
import { CourseNav } from "@/components/CourseNav";
import { ResetPasswordButton } from "@/components/ResetPasswordButton";
import { Badge, Card, EmptyState } from "@/components/ui";
import { getOwnedCourse } from "@/lib/courses";
import { formatManila } from "@/lib/time";

type Section = {
  id: string;
  name: string;
  join_code: string;
  section_members: {
    joined_at: string;
    profiles: { id: string; full_name: string; student_no: string | null; email: string | null; avatar: string | null } | null;
  }[];
};

export default async function StudentsPage({ params }: { params: Promise<{ courseId: string }> }) {
  const { courseId } = await params;
  const { profile, supabase, course } = await getOwnedCourse(courseId);
  const { data } = await supabase
    .from("sections")
    .select("id, name, join_code, section_members(joined_at, profiles(id, full_name, student_no, email, avatar))")
    .eq("course_id", courseId)
    .order("name");
  const sections = (data ?? []) as unknown as Section[];

  return (
    <AppShell profile={profile}>
      <CourseNav course={course} active="students" />

      {sections.length === 0 && (
        <EmptyState icon="users" title="No sections yet">
          No sections yet. Add one from My courses.
        </EmptyState>
      )}

      {sections.map((s) => {
        const members = s.section_members
          .filter((m) => m.profiles)
          .sort((a, b) => a.profiles!.full_name.localeCompare(b.profiles!.full_name));
        return (
          <Card key={s.id} flush>
            <div className="flex items-center justify-between gap-2 border-b border-ink-100 bg-ink-50 px-4 py-3">
              <h2 className="min-w-0 font-semibold">
                {s.name} <span className="text-sm font-normal text-ink-600">· {members.length} students</span>
              </h2>
              <Badge tone="brand" className="font-mono !text-sm tracking-widest" >
                {s.join_code}
              </Badge>
            </div>
            {members.length === 0 ? (
              <p className="px-4 py-4 text-sm text-ink-600">No students have joined yet.</p>
            ) : (
              <ul className="divide-y divide-ink-100">
                {members.map((m) => {
                  const p = m.profiles!;
                  return (
                    <li key={p.id} className="space-y-2 px-4 py-3">
                      <div className="flex min-w-0 items-start gap-3">
                        <Avatar name={p.full_name} src={p.avatar} size={40} />
                        <div className="min-w-0">
                          <p className="truncate font-semibold">{p.full_name || "—"}</p>
                          <p className="truncate text-xs text-ink-600">
                            {[p.student_no, p.email].filter(Boolean).join(" · ")} · joined {formatManila(m.joined_at)}
                          </p>
                        </div>
                      </div>
                      <div className="flex flex-wrap items-start gap-2 pl-[52px]">
                        <Link
                          href={`/messages/${p.id}`}
                          className="btn btn-secondary btn-sm"
                        >
                          Message
                        </Link>
                        <ResetPasswordButton userId={p.id} name={p.full_name || "this student"} />
                        <form action={removeFromSection}>
                          <input type="hidden" name="section_id" value={s.id} />
                          <input type="hidden" name="student_id" value={p.id} />
                          <input type="hidden" name="course_id" value={courseId} />
                          <button className="btn btn-quiet-danger btn-sm">Remove</button>
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
