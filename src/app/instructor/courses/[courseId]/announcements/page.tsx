import { AppShell } from "@/components/AppShell";
import { AnnouncementForm } from "@/components/AnnouncementForm";
import { AnnouncementList, type AnnouncementRow } from "@/components/AnnouncementList";
import { CourseNav } from "@/components/CourseNav";
import { getOwnedCourse } from "@/lib/courses";
import { mailStatus } from "@/lib/mail";

export default async function AnnouncementsPage({ params }: { params: Promise<{ courseId: string }> }) {
  const { courseId } = await params;
  const { profile, supabase, course } = await getOwnedCourse(courseId);
  const [{ data: sections }, { data: anns }] = await Promise.all([
    supabase.from("sections").select("id, name").eq("course_id", courseId).order("name"),
    supabase
      .from("announcements")
      .select("id, title, body, section_ids, created_at, emailed_at, emailed_count")
      .eq("course_id", courseId)
      .order("created_at", { ascending: false })
      .limit(50),
  ]);
  const secs = (sections ?? []) as { id: string; name: string }[];
  const names = new Map(secs.map((s) => [s.id, s.name]));
  const rows: AnnouncementRow[] = ((anns ?? []) as (Omit<AnnouncementRow, "audience"> & { section_ids: string[] | null })[]).map(
    ({ section_ids, ...a }) => ({
      ...a,
      audience: section_ids ? section_ids.map((id) => names.get(id) ?? "?").join(", ") : "All sections",
    }),
  );

  return (
    <AppShell profile={profile}>
      <CourseNav course={course} active="announcements" />
      <AnnouncementForm courseId={courseId} sections={secs} emailReady={mailStatus().configured} />
      <AnnouncementList courseId={courseId} items={rows} />
    </AppShell>
  );
}
