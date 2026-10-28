import { notFound } from "next/navigation";
import { AppShell } from "@/components/AppShell";
import { BackLink } from "@/components/ui";
import { CheckAnswersView } from "@/components/CheckAnswersView";
import { getOwnedCourse } from "@/lib/courses";

export default async function CheckAnswersPage({
  params,
  searchParams,
}: {
  params: Promise<{ courseId: string; examId: string }>;
  searchParams: Promise<{ item?: string; show?: string }>;
}) {
  const { courseId, examId } = await params;
  const sp = await searchParams;
  const { profile, supabase, course } = await getOwnedCourse(courseId);
  const { data: exam } = await supabase
    .from("exams")
    .select("id, title")
    .eq("id", examId)
    .eq("course_id", courseId)
    .maybeSingle();
  if (!exam) notFound();

  return (
    <AppShell profile={profile}>
      <BackLink href={`/instructor/courses/${courseId}/exams/${examId}`}>{course.code} · {exam.title}</BackLink>
      <CheckAnswersView
        examId={examId}
        courseId={courseId}
        base={`/instructor/courses/${courseId}/exams/${examId}/check`}
        item={sp.item}
        show={sp.show}
        linkStudents
      />
    </AppShell>
  );
}
