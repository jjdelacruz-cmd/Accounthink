import { notFound } from "next/navigation";
import { AppShell } from "@/components/AppShell";
import { BackLink, LinkButton } from "@/components/ui";
import { LiveMonitor } from "@/components/LiveMonitor";
import { getOwnedCourse } from "@/lib/courses";

export default async function MonitorPage({
  params,
}: {
  params: Promise<{ courseId: string; examId: string }>;
}) {
  const { courseId, examId } = await params;
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
      <LiveMonitor examId={examId} />
      <LinkButton href={`/instructor/courses/${courseId}/exams/${examId}/results`} variant="secondary" block icon="chart">
        Results &amp; item analysis →
      </LinkButton>
    </AppShell>
  );
}
