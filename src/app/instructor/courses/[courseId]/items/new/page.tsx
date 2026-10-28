import { AppShell } from "@/components/AppShell";
import { ItemEditor } from "@/components/ItemEditor";
import { BackLink, Card, PageTitle } from "@/components/ui";
import { getOwnedCourse } from "@/lib/courses";
import { getTopics } from "../topics";

export default async function NewItemPage({ params }: { params: Promise<{ courseId: string }> }) {
  const { courseId } = await params;
  const { profile, supabase, course } = await getOwnedCourse(courseId);
  const topics = await getTopics(supabase, courseId);

  return (
    <AppShell profile={profile}>
      <BackLink href={`/instructor/courses/${courseId}/items`}>{course.code} item bank</BackLink>
      <PageTitle>New item</PageTitle>
      <Card>
        <ItemEditor courseId={courseId} topics={topics} />
      </Card>
    </AppShell>
  );
}
