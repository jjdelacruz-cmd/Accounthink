"use server";

import { revalidatePath } from "next/cache";
import { requireRole } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import type { FormState } from "./auth";

export async function createCourse(_: FormState, formData: FormData): Promise<FormState> {
  const profile = await requireRole("instructor", "admin");
  const code = String(formData.get("code") ?? "").trim().toUpperCase();
  const title = String(formData.get("title") ?? "").trim();
  if (!code || !title) return { error: "Course code and title are required." };

  const supabase = await createClient();
  const { error } = await supabase.from("courses").insert({ instructor_id: profile.id, code, title });
  if (error) return { error: error.message };

  revalidatePath("/instructor");
  return { message: `Added ${code}.` };
}

export async function createSection(_: FormState, formData: FormData): Promise<FormState> {
  await requireRole("instructor", "admin");
  const courseId = String(formData.get("course_id") ?? "");
  const name = String(formData.get("name") ?? "").trim().toUpperCase();
  const schoolYear = String(formData.get("school_year") ?? "").trim() || null;
  const semester = String(formData.get("semester") ?? "").trim() || null;
  if (!courseId || !name) return { error: "Section name is required." };

  const supabase = await createClient();
  const { error } = await supabase
    .from("sections")
    .insert({ course_id: courseId, name, school_year: schoolYear, semester });
  if (error) return { error: error.message };

  revalidatePath("/instructor");
  return { message: `Added section ${name}.` };
}

export async function setJoinOpen(formData: FormData) {
  await requireRole("instructor", "admin");
  const sectionId = String(formData.get("section_id") ?? "");
  const open = formData.get("open") === "true";

  const supabase = await createClient();
  await supabase.from("sections").update({ join_open: open }).eq("id", sectionId);
  revalidatePath("/instructor");
}
