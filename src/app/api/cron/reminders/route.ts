import { createClient } from "@supabase/supabase-js";
import { timingSafeEqual } from "node:crypto";
import { mailStatus, sendToMany } from "@/lib/mail";
import { reminderMail } from "@/lib/mailtext";

// Called every hour by netlify/functions/reminders.mjs. Emails students whose exam opens within the
// next 24 hours (once per exam). It needs CRON_SECRET (Netlify env) to match the 'cron_secret' row in
// the database (see README), so nobody else can trigger it or read the student list.
export const dynamic = "force-dynamic";

type Due = {
  exam_id: string;
  title: string;
  course_code: string;
  opens_at: string | null;
  closes_at: string | null;
  time_limit_minutes: number | null;
  emails: string[];
};

function authorized(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || secret.length < 12) return false;
  const given = (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "");
  const a = Buffer.from(given);
  const b = Buffer.from(secret);
  return a.length === b.length && timingSafeEqual(a, b);
}

async function run(req: Request) {
  if (!authorized(req)) return Response.json({ error: "Not allowed" }, { status: 401 });
  // Don't mark exams as reminded when nothing can be sent.
  if (!mailStatus().configured) return Response.json({ skipped: "Email isn't set up", exams: 0, emailed: 0 });

  const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data, error } = await supabase.rpc("claim_exam_reminders", { p_secret: process.env.CRON_SECRET });
  if (error) return Response.json({ error: error.message }, { status: 500 });

  let emailed = 0;
  const failures: string[] = [];
  for (const e of (data ?? []) as Due[]) {
    const res = await sendToMany(
      e.emails,
      reminderMail({ title: e.title, course: e.course_code, opens_at: e.opens_at, closes_at: e.closes_at, minutes: e.time_limit_minutes }),
    );
    emailed += res.sent;
    if (res.error) failures.push(`${e.title}: ${res.error}`);
  }
  return Response.json({ exams: (data ?? []).length, emailed, failures });
}

export const GET = run;
export const POST = run;
