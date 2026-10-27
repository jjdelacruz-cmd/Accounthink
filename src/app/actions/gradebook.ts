"use server";

import { requireRole } from "@/lib/auth";
import type { Gradebook } from "@/lib/gradebook";
import { createClient } from "@/lib/supabase/server";

/** Scores of every exam in all of the signed-in instructor's subjects, for one Excel file. */
export async function loadAllGradebooks(): Promise<{ error?: string; books?: Gradebook[]; by?: string }> {
  const me = await requireRole("instructor", "admin");
  const supabase = await createClient();
  const { data: courses, error } = await supabase.from("courses").select("id").eq("instructor_id", me.id).order("code");
  if (error) return { error: error.message };
  if (!courses?.length) return { error: "You have no subjects yet." };

  const books: Gradebook[] = [];
  for (const c of courses) {
    const { data, error: e } = await supabase.rpc("course_gradebook", { p_course_id: c.id });
    if (e) return { error: e.message };
    const book = data as Gradebook;
    if (book.exams.length) books.push(book);
  }
  if (!books.length) return { error: "None of your subjects has a published exam yet." };
  return { books, by: me.full_name };
}
