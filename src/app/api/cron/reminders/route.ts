import { createClient } from "@supabase/supabase-js";
import { timingSafeEqual } from "node:crypto";
import { mailStatus, sendToMany } from "@/lib/mail";
import { reminderMail, scoreUpdateMail } from "@/lib/mailtext";

// Called every hour by netlify/functions/reminders.mjs. It
//  1. emails students whose exam opens within the next 24 hours (once per exam), and
//  2. emails students whose score was changed by their instructor or a checker (once the changes have
//     been quiet for 10 minutes), so nobody gets two emails for a quick fix.
// It needs CRON_SECRET (Netlify env) to match the 'cron_secret' row in the database (see README),
// so nobody else can trigger it or read the student list.
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

type ScoreEmail = {
  email: string;
  name: string;
  exam_title: string;
  course_code: string;
  old_score: number | null;
  new_score: number;
  max_score: number;
  by_hand: boolean;
};

function authorized(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || secret.length < 12) return false;
  const given = (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "");
  const a = Buffer.from(given);
  const b = Buffer.from(secret);
  return a.length === b.length && timingSafeEqual(a, b);
}

/** Runs `fn` over `items` a few at a time (a serverless function has limited time). */
async function inBatches<T>(items: T[], size: number, fn: (item: T) => Promise<void>) {
  for (let i = 0; i < items.length; i += size) await Promise.all(items.slice(i, i + size).map(fn));
}

async function run(req: Request) {
  if (!authorized(req)) return Response.json({ error: "Not allowed" }, { status: 401 });
  // Nothing is claimed (and so nothing is lost) when email can't be sent.
  if (!mailStatus().configured) return Response.json({ skipped: "Email isn't set up", exams: 0, emailed: 0, scoreEmails: 0 });

  const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const failures: string[] = [];

  // 1. Exams opening within 24 hours
  let exams = 0;
  let emailed = 0;
  {
    const { data, error } = await supabase.rpc("claim_exam_reminders", { p_secret: process.env.CRON_SECRET });
    if (error) failures.push(`reminders: ${error.message}`);
    for (const e of (data ?? []) as Due[]) {
      exams++;
      const res = await sendToMany(
        e.emails,
        reminderMail({ title: e.title, course: e.course_code, opens_at: e.opens_at, closes_at: e.closes_at, minutes: e.time_limit_minutes }),
      );
      emailed += res.sent;
      if (res.error) failures.push(`${e.title}: ${res.error}`);
    }
  }

  // 2. Changed scores
  let scoreEmails = 0;
  {
    const { data, error } = await supabase.rpc("claim_score_update_emails", { p_secret: process.env.CRON_SECRET });
    if (error) failures.push(`score updates: ${error.message}`);
    await inBatches((data ?? []) as ScoreEmail[], 5, async (u) => {
      const res = await sendToMany(
        [u.email],
        scoreUpdateMail({
          name: u.name,
          course: u.course_code,
          exam: u.exam_title,
          oldScore: u.old_score === null ? null : Number(u.old_score),
          newScore: Number(u.new_score),
          maxScore: Number(u.max_score),
          byHand: u.by_hand,
        }),
      );
      scoreEmails += res.sent;
      if (res.error) failures.push(`score email: ${res.error}`);
    });
  }

  return Response.json({ exams, emailed, scoreEmails, failures });
}

export const GET = run;
export const POST = run;
