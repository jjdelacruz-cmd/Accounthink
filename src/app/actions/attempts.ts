"use server";

import { redirect } from "next/navigation";
import { requireRole } from "@/lib/auth";
import type { AttemptState, DeviceInfo, IntegrityEvent, Question, StudentAnswer } from "@/lib/attempts";
import { createClient } from "@/lib/supabase/server";
import type { FormState } from "./auth";

export async function startExam(_: FormState, formData: FormData): Promise<FormState> {
  await requireRole("student");
  const examId = String(formData.get("exam_id"));
  const code = String(formData.get("code") ?? "").replace(/\D/g, "") || null;
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("start_attempt", { p_exam_id: examId, p_code: code });
  if (error) return { error: error.message };
  redirect(`/student/attempts/${data}`);
}

export type OpenResult =
  | { token: string; state: AttemptState; question: Question }
  | { needsCode: true; wrongCode?: boolean }
  | { done: string }
  | { error: string };

/** Claims the attempt for this device/tab and loads what the exam screen needs. */
export async function openAttempt(
  attemptId: string,
  device: DeviceInfo,
  code: string | null,
  prevToken: string | null,
): Promise<OpenResult> {
  await requireRole("student");
  const supabase = await createClient();
  const { data: claim, error } = await supabase.rpc("claim_attempt", {
    p_attempt_id: attemptId,
    p_device: device,
    p_code: code,
    p_prev_token: prevToken,
  });
  if (error) {
    if (error.message === "Attempt not found") return { error: error.message };
    // Submitted or time is up: finalize and send them to the result.
    const { data: done } = await supabase.rpc("submit_attempt", { p_attempt_id: attemptId });
    return done ? { done: (done as { exam_id: string }).exam_id } : { error: error.message };
  }
  if ((claim as { needs_code?: boolean }).needs_code) return { needsCode: true, wrongCode: !!code };

  const token = (claim as { token: string }).token;
  const [{ data: state, error: stateError }, { data: question, error: qError }] = await Promise.all([
    supabase.rpc("attempt_state", { p_attempt_id: attemptId, p_token: token }),
    supabase.rpc("attempt_question", { p_attempt_id: attemptId, p_token: token, p_index: 0 }),
  ]);
  if (stateError || qError) return { error: (stateError ?? qError)!.message };
  return { token, state: state as AttemptState, question: question as Question };
}

export async function getQuestion(
  attemptId: string,
  token: string,
  index: number,
): Promise<{ error?: string; question?: Question }> {
  await requireRole("student");
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("attempt_question", {
    p_attempt_id: attemptId,
    p_token: token,
    p_index: index,
  });
  if (error) return { error: error.message };
  return { question: data as Question };
}

export async function saveAnswer(
  attemptId: string,
  token: string,
  index: number,
  answer: StudentAnswer,
): Promise<{ error?: string; savedAt?: string }> {
  await requireRole("student");
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("save_response", {
    p_attempt_id: attemptId,
    p_token: token,
    p_index: index,
    p_answer: answer,
  });
  if (error) return { error: error.message };
  return { savedAt: data as string };
}

export async function pingAttempt(
  attemptId: string,
  token: string,
): Promise<{ error?: string; deadline_at?: string; server_now?: string }> {
  await requireRole("student");
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("attempt_ping", { p_attempt_id: attemptId, p_token: token });
  if (error) return { error: error.message };
  return data as { deadline_at: string; server_now: string };
}

export async function logEvents(
  attemptId: string,
  token: string,
  events: IntegrityEvent[],
): Promise<{ error?: string; ended?: boolean }> {
  await requireRole("student");
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("log_integrity_events", {
    p_attempt_id: attemptId,
    p_token: token,
    p_events: events.slice(0, 50),
  });
  if (error) return { error: error.message };
  return { ended: (data as { ended: boolean }).ended };
}

export async function submitAttempt(
  attemptId: string,
  token: string | null,
): Promise<{ error?: string; examId?: string }> {
  await requireRole("student");
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("submit_attempt", { p_attempt_id: attemptId, p_token: token });
  if (error) return { error: error.message };
  return { examId: (data as { exam_id: string }).exam_id };
}
