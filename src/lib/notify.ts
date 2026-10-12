import type { SupabaseClient } from "@supabase/supabase-js";
import { mailStatus, sendToMany } from "@/lib/mail";
import { newExamMail, reminderMail } from "@/lib/mailtext";

export type EmailResult = {
  /** Emails accepted by the mail server. */
  sent: number;
  /** Students in the sections. */
  students: number;
  /** Students who turned emails off. */
  optedOut: number;
  error?: string;
  /** Email isn't set up on this site. */
  notConfigured?: boolean;
};

/** Emails an exam's students ("new exam" when it is published, or a reminder). Runs as the instructor. */
export async function emailExam(supabase: SupabaseClient, examId: string, kind: "new" | "reminder"): Promise<EmailResult> {
  if (!mailStatus().configured) return { sent: 0, students: 0, optedOut: 0, notConfigured: true };

  const [{ data: rec, error: e1 }, { data: exam, error: e2 }] = await Promise.all([
    supabase.rpc("exam_recipients", { p_exam_id: examId }),
    supabase
      .from("exams")
      .select("title, opens_at, closes_at, time_limit_minutes, courses(code)")
      .eq("id", examId)
      .single(),
  ]);
  if (e1 || e2 || !rec || !exam) return { sent: 0, students: 0, optedOut: 0, error: (e1 ?? e2)?.message ?? "Exam not found" };

  const info = {
    title: exam.title as string,
    course: (exam.courses as unknown as { code: string } | null)?.code ?? "",
    opens_at: exam.opens_at as string | null,
    closes_at: exam.closes_at as string | null,
    minutes: exam.time_limit_minutes as number | null,
  };
  const r = rec as { students: number; opted_out: number; emails: string[] };
  const res = await sendToMany(r.emails, kind === "new" ? newExamMail(info) : reminderMail(info));
  if (kind === "new" && res.sent > 0) await supabase.rpc("mark_exam_notified", { p_exam_id: examId });
  return { sent: res.sent, students: r.students, optedOut: r.opted_out, error: res.error };
}

export function describeEmail(r: EmailResult): string {
  if (r.notConfigured) return "Email isn't set up yet, so no emails were sent (students still see it in the app).";
  if (r.error && r.sent === 0) return `Couldn't send email: ${r.error}`;
  const parts = [`Emailed ${r.sent} student${r.sent === 1 ? "" : "s"}`];
  if (r.optedOut) parts.push(`${r.optedOut} turned emails off`);
  return parts.join("; ") + (r.error ? `. Some failed: ${r.error}` : ".");
}
