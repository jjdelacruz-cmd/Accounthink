import Link from "next/link";
import { AppShell } from "@/components/AppShell";
import { Card } from "@/components/ui";
import { requireRole } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";

export type CheckingExam = {
  exam_id: string;
  title: string;
  course_code: string;
  course_title: string;
  instructor: string;
  submitted: number;
  pending: number;
};

export default async function CheckerHome() {
  const profile = await requireRole("checker");
  const supabase = await createClient();
  const { data } = await supabase.rpc("my_checking_exams");
  const exams = (data ?? []) as CheckingExam[];
  const waiting = exams.reduce((n, e) => n + Number(e.pending), 0);

  return (
    <AppShell profile={profile}>
      <div>
        <h1 className="text-xl font-bold">Answers to check</h1>
        <p className="text-sm text-slate-600">
          {exams.length === 0
            ? "Nothing yet. Exams show up here after students have taken them and an instructor has assigned you."
            : waiting > 0
              ? `${waiting} answer${waiting === 1 ? "" : "s"} waiting across ${exams.length} exam${exams.length === 1 ? "" : "s"}.`
              : "Nothing waiting. You can still change a score you set."}
        </p>
      </div>

      {exams.map((e) => (
        <Link key={e.exam_id} href={`/checker/exams/${e.exam_id}`} className="block">
          <Card className="space-y-1 hover:border-emerald-400">
            <p className="text-sm font-semibold text-emerald-700">{e.course_code}</p>
            <p className="font-semibold">{e.title}</p>
            <p className="text-xs text-slate-500">
              {e.course_title} · from {e.instructor}
            </p>
            <p className="pt-1 text-sm">
              <span className="text-slate-600">{e.submitted} submitted</span>
              {" · "}
              {Number(e.pending) > 0 ? (
                <span className="font-semibold text-amber-700">{e.pending} to check</span>
              ) : (
                <span className="font-semibold text-emerald-700">all checked ✓</span>
              )}
            </p>
          </Card>
        </Link>
      ))}

      <p className="text-xs text-slate-500">
        You can see only the answers of exams assigned to you. Multiple-choice answers are graded automatically.
      </p>
    </AppShell>
  );
}
