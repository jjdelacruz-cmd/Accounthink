import { notFound, redirect } from "next/navigation";
import { ExamRunner } from "@/components/ExamRunner";
import type { AttemptState, Question } from "@/lib/attempts";
import { requireRole } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";

export default async function AttemptPage({ params }: { params: Promise<{ attemptId: string }> }) {
  const { attemptId } = await params;
  await requireRole("student");
  const supabase = await createClient();

  const { data, error } = await supabase.rpc("attempt_state", { p_attempt_id: attemptId });
  if (error) {
    if (error.message === "Attempt not found") notFound();
    // Submitted or time is up: finalize and show the result.
    const { data: done } = await supabase.rpc("submit_attempt", { p_attempt_id: attemptId });
    redirect(done ? `/student/exams/${(done as { exam_id: string }).exam_id}` : "/student");
  }
  const state = data as AttemptState;

  const { data: first } = await supabase.rpc("attempt_question", { p_attempt_id: attemptId, p_index: 0 });

  return <ExamRunner state={state} firstQuestion={first as Question} />;
}
