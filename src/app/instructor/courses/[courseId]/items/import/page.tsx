import Link from "next/link";
import { AppShell } from "@/components/AppShell";
import { ItemImporter } from "@/components/ItemImporter";
import { getOwnedCourse } from "@/lib/courses";
import { getTopics } from "../topics";

export default async function ImportItemsPage({ params }: { params: Promise<{ courseId: string }> }) {
  const { courseId } = await params;
  const { profile, supabase, course } = await getOwnedCourse(courseId);

  // Existing questions, to flag duplicates in the preview.
  const { data } = await supabase.from("items").select("stem").eq("course_id", courseId).limit(5000);
  const existingStems = (data ?? []).map((r) => r.stem as string);
  const topics = await getTopics(supabase, courseId);

  return (
    <AppShell profile={profile}>
      <Link href={`/instructor/courses/${courseId}/items`} className="text-sm font-medium text-emerald-700">
        ← {course.code} item bank
      </Link>
      <h1 className="text-xl font-bold">Import questions</h1>
      <ItemImporter courseId={courseId} courseCode={course.code} existingStems={existingStems} topics={topics} />
    </AppShell>
  );
}
