"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireRole } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { manilaInputToIso } from "@/lib/time";
import type { FormState } from "./auth";

const examPath = (courseId: string, examId: string) => `/instructor/courses/${courseId}/exams/${examId}`;
const KINDS = ["quiz", "prelim", "midterm", "final", "other"];

export async function createExam(_: FormState, formData: FormData): Promise<FormState> {
  const profile = await requireRole("instructor", "admin");
  const courseId = String(formData.get("course_id"));
  const title = String(formData.get("title") ?? "").trim();
  const kind = String(formData.get("kind") ?? "quiz");
  if (!title) return { error: "Give the exam a title." };
  if (!KINDS.includes(kind)) return { error: "Pick an exam type." };

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("exams")
    .insert({ course_id: courseId, title, kind, created_by: profile.id })
    .select("id")
    .single();
  if (error) return { error: error.message };

  redirect(examPath(courseId, data.id));
}

export async function updateExamSettings(_: FormState, formData: FormData): Promise<FormState> {
  await requireRole("instructor", "admin");
  const examId = String(formData.get("exam_id"));
  const courseId = String(formData.get("course_id"));
  const title = String(formData.get("title") ?? "").trim();
  const kind = String(formData.get("kind") ?? "quiz");
  const timeLimit = String(formData.get("time_limit_minutes") ?? "").trim();
  const opensAt = manilaInputToIso(String(formData.get("opens_at") ?? ""));
  const closesAt = manilaInputToIso(String(formData.get("closes_at") ?? ""));
  const sectionIds = formData.getAll("section_ids").map(String);

  if (!title) return { error: "Give the exam a title." };
  if (!KINDS.includes(kind)) return { error: "Pick an exam type." };
  const minutes = timeLimit ? Number(timeLimit) : null;
  if (minutes !== null && !(Number.isInteger(minutes) && minutes >= 1 && minutes <= 600)) {
    return { error: "Time limit must be a whole number from 1 to 600 minutes." };
  }
  if (opensAt && closesAt && closesAt <= opensAt) return { error: "Closing time must be after opening time." };

  const supabase = await createClient();
  const { error } = await supabase
    .from("exams")
    .update({
      title,
      kind,
      instructions: String(formData.get("instructions") ?? "").trim() || null,
      time_limit_minutes: minutes,
      opens_at: opensAt,
      closes_at: closesAt,
      shuffle_items: formData.get("shuffle_items") === "on",
      shuffle_choices: formData.get("shuffle_choices") === "on",
      show_score: formData.get("show_score") === "on",
    })
    .eq("id", examId);
  if (error) return { error: error.message };

  // Replace section assignments.
  const { data: current } = await supabase.from("exam_sections").select("section_id").eq("exam_id", examId);
  const have = new Set((current ?? []).map((r) => r.section_id as string));
  const want = new Set(sectionIds);
  const toRemove = [...have].filter((id) => !want.has(id));
  const toAdd = [...want].filter((id) => !have.has(id));
  if (toRemove.length) {
    const { error: e } = await supabase
      .from("exam_sections")
      .delete()
      .eq("exam_id", examId)
      .in("section_id", toRemove);
    if (e) return { error: e.message };
  }
  if (toAdd.length) {
    const { error: e } = await supabase
      .from("exam_sections")
      .insert(toAdd.map((section_id) => ({ exam_id: examId, section_id })));
    if (e) return { error: e.message };
  }

  revalidatePath(examPath(courseId, examId));
  return { message: "Settings saved." };
}

export async function addExamItems(examId: string, courseId: string, itemIds: string[]) {
  await requireRole("instructor", "admin");
  if (itemIds.length === 0) return { error: "Select at least one item." };
  const supabase = await createClient();
  const { data: last } = await supabase
    .from("exam_items")
    .select("position")
    .eq("exam_id", examId)
    .order("position", { ascending: false })
    .limit(1)
    .maybeSingle();
  const start = (last?.position ?? 0) + 1;
  const { error } = await supabase
    .from("exam_items")
    .upsert(
      itemIds.map((item_id, i) => ({ exam_id: examId, item_id, position: start + i })),
      { onConflict: "exam_id,item_id", ignoreDuplicates: true },
    );
  if (error) return { error: error.message };
  revalidatePath(examPath(courseId, examId));
  return {};
}

export async function removeExamItem(formData: FormData) {
  await requireRole("instructor", "admin");
  const examId = String(formData.get("exam_id"));
  const courseId = String(formData.get("course_id"));
  const itemId = String(formData.get("item_id"));
  const supabase = await createClient();
  await supabase.from("exam_items").delete().eq("exam_id", examId).eq("item_id", itemId);
  revalidatePath(examPath(courseId, examId));
}

export async function moveExamItem(formData: FormData) {
  await requireRole("instructor", "admin");
  const examId = String(formData.get("exam_id"));
  const courseId = String(formData.get("course_id"));
  const itemId = String(formData.get("item_id"));
  const dir = formData.get("dir") === "up" ? -1 : 1;

  const supabase = await createClient();
  const { data } = await supabase
    .from("exam_items")
    .select("item_id, position")
    .eq("exam_id", examId)
    .order("position");
  const rows = data ?? [];
  const i = rows.findIndex((r) => r.item_id === itemId);
  const j = i + dir;
  if (i < 0 || j < 0 || j >= rows.length) return;

  // Renumber 1..n with the two rows swapped.
  [rows[i], rows[j]] = [rows[j], rows[i]];
  await supabase
    .from("exam_items")
    .upsert(rows.map((r, k) => ({ exam_id: examId, item_id: r.item_id, position: k + 1 })));
  revalidatePath(examPath(courseId, examId));
}

export async function setExamStatus(_: FormState, formData: FormData): Promise<FormState> {
  await requireRole("instructor", "admin");
  const examId = String(formData.get("exam_id"));
  const courseId = String(formData.get("course_id"));
  const status = String(formData.get("status"));
  if (!["draft", "published", "closed"].includes(status)) return { error: "Unknown status." };

  const supabase = await createClient();
  const { error } = await supabase.from("exams").update({ status }).eq("id", examId);
  if (error) return { error: error.message };

  revalidatePath(examPath(courseId, examId));
  return { message: status === "published" ? "Published." : status === "closed" ? "Closed." : "Back to draft." };
}

export async function deleteExam(formData: FormData) {
  await requireRole("instructor", "admin");
  const examId = String(formData.get("exam_id"));
  const courseId = String(formData.get("course_id"));
  const supabase = await createClient();
  await supabase.from("exams").delete().eq("id", examId).eq("status", "draft");
  redirect(`/instructor/courses/${courseId}/exams`);
}
