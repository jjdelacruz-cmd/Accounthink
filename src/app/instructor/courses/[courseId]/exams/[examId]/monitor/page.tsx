import Link from "next/link";
import { notFound } from "next/navigation";
import { AppShell } from "@/components/AppShell";
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
      <Link href={`/instructor/courses/${courseId}/exams/${examId}`} className="text-sm font-medium text-emerald-700">
        ← {course.code} · {exam.title}
      </Link>
      <LiveMonitor examId={examId} />
      <Link
        href={`/instructor/courses/${courseId}/exams/${examId}/results`}
        className="block rounded-xl border border-slate-300 bg-white px-4 py-3 text-center font-semibold"
      >
        Results &amp; item analysis →
      </Link>
    </AppShell>
  );
}
