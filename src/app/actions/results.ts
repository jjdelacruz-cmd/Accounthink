"use server";

import { revalidatePath } from "next/cache";
import { requireRole } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import type { FormState } from "./auth";

const resultsPath = (courseId: string, examId: string) => `/instructor/courses/${courseId}/exams/${examId}/results`;

export async function regradeExam(courseId: string, examId: string): Promise<{ error?: string; count?: number }> {
  await requireRole("instructor", "admin");
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("regrade_exam", { p_exam_id: examId });
  if (error) return { error: error.message };
  revalidatePath(resultsPath(courseId, examId));
  return { count: data as number };
}

/** Accept a student's wording for an identification item, then re-grade the exam. */
export async function acceptAnswer(
  courseId: string,
  examId: string,
  itemId: string,
  text: string,
): Promise<{ error?: string }> {
  await requireRole("instructor", "admin");
  const supabase = await createClient();
  const { error } = await supabase.rpc("accept_identification_answer", { p_item_id: itemId, p_text: text });
  if (error) return { error: error.message };
  const { error: e2 } = await supabase.rpc("regrade_exam", { p_exam_id: examId });
  if (e2) return { error: e2.message };
  revalidatePath(resultsPath(courseId, examId));
  return {};
}

export async function setPassingPercent(_: FormState, formData: FormData): Promise<FormState> {
  await requireRole("instructor", "admin");
  const examId = String(formData.get("exam_id"));
  const courseId = String(formData.get("course_id"));
  const raw = String(formData.get("passing_percent") ?? "").trim();
  const value = raw ? Number(raw) : null;
  if (value !== null && !(value >= 0 && value <= 100)) return { error: "Enter a percentage from 0 to 100." };

  const supabase = await createClient();
  const { error } = await supabase.from("exams").update({ passing_percent: value }).eq("id", examId);
  if (error) return { error: error.message };
  revalidatePath(resultsPath(courseId, examId));
  return { message: value === null ? "Passing mark cleared." : `Passing mark set to ${value}%.` };
}
