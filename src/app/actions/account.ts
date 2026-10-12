"use server";

import { revalidatePath } from "next/cache";
import { getProfile, requireRole } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import type { FormState } from "./auth";

/** Instructor (own students) or admin (any non-admin) sets a temporary password. */
export async function resetUserPassword(userId: string, newPassword: string): Promise<{ error?: string }> {
  await requireRole("instructor", "admin");
  const supabase = await createClient();
  const { error } = await supabase.rpc("reset_user_password", { p_user_id: userId, p_new_password: newPassword });
  return error ? { error: error.message } : {};
}

export async function removeFromSection(formData: FormData) {
  await requireRole("instructor", "admin");
  const sectionId = String(formData.get("section_id"));
  const studentId = String(formData.get("student_id"));
  const courseId = String(formData.get("course_id"));
  const supabase = await createClient();
  await supabase.from("section_members").delete().eq("section_id", sectionId).eq("student_id", studentId);
  revalidatePath(`/instructor/courses/${courseId}/students`);
}

export async function updateProfile(_: FormState, formData: FormData): Promise<FormState> {
  const me = await getProfile();
  if (!me) return { error: "Not signed in." };
  const fullName = String(formData.get("full_name") ?? "").trim();
  const studentNo = String(formData.get("student_no") ?? "").trim();
  if (!fullName) return { error: "Name is required." };
  const supabase = await createClient();
  const { error } = await supabase
    .from("profiles")
    .update({ full_name: fullName, student_no: studentNo || null })
    .eq("id", me.id);
  if (error) return { error: error.message };
  revalidatePath("/account");
  return { message: "Saved." };
}

export async function changePassword(_: FormState, formData: FormData): Promise<FormState> {
  const me = await getProfile();
  if (!me) return { error: "Not signed in." };
  const password = String(formData.get("password") ?? "");
  const confirm = String(formData.get("confirm") ?? "");
  if (password.length < 8) return { error: "Password must be at least 8 characters." };
  if (password !== confirm) return { error: "The two passwords don't match." };
  const supabase = await createClient();
  const { error } = await supabase.auth.updateUser({ password });
  if (error) return { error: error.message };
  return { message: "Password changed." };
}

/** Saves (or removes, with null) the signed-in user's photo: a small JPEG data URL made in the browser. */
export async function setAvatar(dataUrl: string | null): Promise<{ error?: string }> {
  const me = await getProfile();
  if (!me) return { error: "Not signed in." };
  if (dataUrl !== null && (!/^data:image\/jpeg;base64,[A-Za-z0-9+/=]+$/.test(dataUrl) || dataUrl.length > 40000)) {
    return { error: "That picture isn't usable. Choose a different photo." };
  }
  const supabase = await createClient();
  const { error } = await supabase.from("profiles").update({ avatar: dataUrl }).eq("id", me.id);
  if (error) return { error: error.message };
  revalidatePath("/", "layout");
  return {};
}

export async function setEmailNotifications(_: FormState, formData: FormData): Promise<FormState> {
  const me = await getProfile();
  if (!me) return { error: "Not signed in." };
  const on = formData.get("email_notifications") === "on";
  const supabase = await createClient();
  const { error } = await supabase.from("profiles").update({ email_notifications: on }).eq("id", me.id);
  if (error) return { error: error.message };
  revalidatePath("/account");
  return { message: on ? "You'll get emails about exams and announcements." : "Emails are off. You'll still see everything in the app." };
}
