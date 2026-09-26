import Link from "next/link";
import { AppShell } from "@/components/AppShell";
import { ItemEditor } from "@/components/ItemEditor";
import { Card } from "@/components/ui";
import { getOwnedCourse } from "@/lib/courses";
import { getTopics } from "../topics";

export default async function NewItemPage({ params }: { params: Promise<{ courseId: string }> }) {
  const { courseId } = await params;
  const { profile, supabase, course } = await getOwnedCourse(courseId);
  const topics = await getTopics(supabase, courseId);

  return (
    <AppShell profile={profile}>
      <Link href={`/instructor/courses/${courseId}/items`} className="text-sm font-medium text-emerald-700">
        ← {course.code} item bank
      </Link>
      <h1 className="text-xl font-bold">New item</h1>
      <Card>
        <ItemEditor courseId={courseId} topics={topics} />
      </Card>
    </AppShell>
  );
}
