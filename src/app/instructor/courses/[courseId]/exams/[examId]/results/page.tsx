import Link from "next/link";
import { notFound } from "next/navigation";
import { AppShell } from "@/components/AppShell";
import { ResultsView } from "@/components/ResultsView";
import { getOwnedCourse } from "@/lib/courses";
import type { MonitorData } from "@/lib/monitor";
import type { ItemAnalysis } from "@/lib/results";

export default async function ResultsPage({
  params,
}: {
  params: Promise<{ courseId: string; examId: string }>;
}) {
  const { courseId, examId } = await params;
  const { profile, supabase, course } = await getOwnedCourse(courseId);
  const { data: exam } = await supabase
    .from("exams")
    .select("id, title, passing_percent")
    .eq("id", examId)
    .eq("course_id", courseId)
    .maybeSingle();
  if (!exam) notFound();

  // Both functions finalize anyone whose time ran out first.
  const [{ data: monitor, error: e1 }, { data: analysis, error: e2 }] = await Promise.all([
    supabase.rpc("exam_monitor", { p_exam_id: examId }),
    supabase.rpc("exam_item_analysis", { p_exam_id: examId }),
  ]);

  return (
    <AppShell profile={profile}>
      <Link href={`/instructor/courses/${courseId}/exams/${examId}`} className="text-sm font-medium text-emerald-700">
        ← {course.code} · {exam.title}
      </Link>
      {e1 || e2 ? (
        <p className="rounded-xl bg-red-50 p-3 text-red-800">{(e1 ?? e2)!.message}</p>
      ) : (
        <ResultsView
          courseId={courseId}
          examId={examId}
          courseCode={course.code}
          examTitle={exam.title}
          passingPercent={exam.passing_percent === null ? null : Number(exam.passing_percent)}
          monitor={monitor as MonitorData}
          analysis={analysis as ItemAnalysis}
        />
      )}
    </AppShell>
  );
}
