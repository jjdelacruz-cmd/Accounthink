"use server";

import { redirect } from "next/navigation";
import { requireRole } from "@/lib/auth";
import type { Question, StudentAnswer } from "@/lib/attempts";
import { createClient } from "@/lib/supabase/server";
import type { FormState } from "./auth";

export async function startExam(_: FormState, formData: FormData): Promise<FormState> {
  await requireRole("student");
  const examId = String(formData.get("exam_id"));
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("start_attempt", { p_exam_id: examId });
  if (error) return { error: error.message };
  redirect(`/student/attempts/${data}`);
}

export async function getQuestion(attemptId: string, index: number): Promise<{ error?: string; question?: Question }> {
  await requireRole("student");
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("attempt_question", { p_attempt_id: attemptId, p_index: index });
  if (error) return { error: error.message };
  return { question: data as Question };
}

export async function saveAnswer(
  attemptId: string,
  index: number,
  answer: StudentAnswer,
): Promise<{ error?: string; savedAt?: string }> {
  await requireRole("student");
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("save_response", {
    p_attempt_id: attemptId,
    p_index: index,
    p_answer: answer,
  });
  if (error) return { error: error.message };
  return { savedAt: data as string };
}

export async function submitAttempt(attemptId: string): Promise<{ error?: string; examId?: string }> {
  await requireRole("student");
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("submit_attempt", { p_attempt_id: attemptId });
  if (error) return { error: error.message };
  return { examId: (data as { exam_id: string }).exam_id };
}
