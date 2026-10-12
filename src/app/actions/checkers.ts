"use server";

import { revalidatePath } from "next/cache";
import { requireRole } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";

const examPath = (courseId: string, examId: string) => `/instructor/courses/${courseId}/exams/${examId}`;

/** Gives a checker account access to the answers of this exam (and nothing else). */
export async function addChecker(courseId: string, examId: string, email: string): Promise<{ error?: string; name?: string }> {
  await requireRole("instructor", "admin");
  if (!email.trim()) return { error: "Enter the checker's email." };
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("assign_checker", { p_exam_id: examId, p_email: email });
  if (error) return { error: error.message };
  revalidatePath(examPath(courseId, examId));
  return { name: (data as { full_name: string }).full_name };
}

export async function removeChecker(courseId: string, examId: string, checkerId: string): Promise<{ error?: string }> {
  await requireRole("instructor", "admin");
  const supabase = await createClient();
  const { error } = await supabase.rpc("remove_checker", { p_exam_id: examId, p_checker_id: checkerId });
  if (error) return { error: error.message };
  revalidatePath(examPath(courseId, examId));
  return {};
}
