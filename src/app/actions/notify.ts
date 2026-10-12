"use server";

import { revalidatePath } from "next/cache";
import { requireRole } from "@/lib/auth";
import { mailStatus, sendToMany } from "@/lib/mail";
import { announcementMail, testMail } from "@/lib/mailtext";
import { describeEmail, emailExam } from "@/lib/notify";
import { createClient } from "@/lib/supabase/server";
import type { FormState } from "./auth";

/** "Email students a reminder now" on a published exam. */
export async function sendExamReminder(courseId: string, examId: string): Promise<{ error?: string; message?: string }> {
  await requireRole("instructor", "admin");
  const supabase = await createClient();
  const r = await emailExam(supabase, examId, "reminder");
  if (r.notConfigured || (r.error && r.sent === 0)) return { error: describeEmail(r) };
  revalidatePath(`/instructor/courses/${courseId}/exams/${examId}`);
  return { message: describeEmail(r) };
}

/** Posts an announcement to a course (all sections, or the ticked ones) and optionally emails it. */
export async function postAnnouncement(_: FormState, formData: FormData): Promise<FormState> {
  const me = await requireRole("instructor", "admin");
  const courseId = String(formData.get("course_id") ?? "");
  const title = String(formData.get("title") ?? "").trim();
  const body = String(formData.get("body") ?? "").trim();
  const sectionIds = formData.getAll("section_ids").map(String);
  const allSections = formData.get("all_sections") === "on" || sectionIds.length === 0;
  if (!title) return { error: "Give the announcement a title." };
  if (!body) return { error: "Write the announcement." };
  if (title.length > 150) return { error: "The title can be up to 150 characters." };
  if (body.length > 5000) return { error: "The announcement can be up to 5,000 characters." };

  const supabase = await createClient();
  const { data: course } = await supabase.from("courses").select("code").eq("id", courseId).single();
  const { data: ann, error } = await supabase
    .from("announcements")
    .insert({
      course_id: courseId,
      title,
      body,
      section_ids: allSections ? null : sectionIds,
      created_by: me.id,
    })
    .select("id")
    .single();
  if (error) return { error: error.message };
  revalidatePath(`/instructor/courses/${courseId}/announcements`);
  revalidatePath("/student");

  if (formData.get("send_email") !== "on") return { message: "Posted. Students see it in the app." };
  if (!mailStatus().configured) {
    return { message: "Posted. Email isn't set up yet, so students only see it in the app." };
  }
  const { data: rec, error: e2 } = await supabase.rpc("announcement_recipients", { p_id: ann.id });
  if (e2 || !rec) return { message: `Posted, but couldn't look up who to email: ${e2?.message ?? "unknown error"}` };
  const r = rec as { students: number; opted_out: number; emails: string[] };
  const res = await sendToMany(r.emails, announcementMail(course?.code ?? "", title, body));
  if (res.sent > 0) await supabase.rpc("mark_announcement_emailed", { p_id: ann.id, p_count: res.sent });
  revalidatePath(`/instructor/courses/${courseId}/announcements`);
  const extra = r.opted_out ? `; ${r.opted_out} turned emails off` : "";
  return res.error && res.sent === 0
    ? { message: `Posted, but the email failed: ${res.error}` }
    : { message: `Posted and emailed ${res.sent} student${res.sent === 1 ? "" : "s"}${extra}.` };
}

export async function deleteAnnouncement(courseId: string, id: string): Promise<{ error?: string }> {
  await requireRole("instructor", "admin");
  const supabase = await createClient();
  const { error } = await supabase.from("announcements").delete().eq("id", id);
  if (error) return { error: error.message };
  revalidatePath(`/instructor/courses/${courseId}/announcements`);
  revalidatePath("/student");
  return {};
}

/** Admin: sends a test email to the admin's own address. */
export async function sendTestEmail(): Promise<{ error?: string; message?: string }> {
  await requireRole("admin");
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user?.email) return { error: "Your account has no email address." };
  if (!mailStatus().configured) return { error: "Email isn't set up yet. See the missing settings above." };
  const res = await sendToMany([user.email], testMail());
  return res.sent > 0 ? { message: `Sent to ${user.email}. Check your inbox (and spam).` } : { error: res.error ?? "Could not send." };
}
