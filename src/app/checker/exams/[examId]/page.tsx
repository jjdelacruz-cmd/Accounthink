import { notFound } from "next/navigation";
import { AppShell } from "@/components/AppShell";
import { BackLink } from "@/components/ui";
import { CheckAnswersView } from "@/components/CheckAnswersView";
import { requireRole } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import type { CheckingExam } from "../../page";

export default async function CheckerExamPage({
  params,
  searchParams,
}: {
  params: Promise<{ examId: string }>;
  searchParams: Promise<{ item?: string; show?: string }>;
}) {
  const { examId } = await params;
  const sp = await searchParams;
  const profile = await requireRole("checker");
  const supabase = await createClient();
  // Only exams assigned to this checker that have been taken come back.
  const { data } = await supabase.rpc("my_checking_exams");
  const exam = ((data ?? []) as CheckingExam[]).find((e) => e.exam_id === examId);
  if (!exam) notFound();

  return (
    <AppShell profile={profile}>
      <BackLink href="/checker">{exam.course_code} · {exam.title}</BackLink>
      <CheckAnswersView
        examId={examId}
        courseId=""
        base={`/checker/exams/${examId}`}
        item={sp.item}
        show={sp.show}
        linkStudents={false}
      />
    </AppShell>
  );
}
