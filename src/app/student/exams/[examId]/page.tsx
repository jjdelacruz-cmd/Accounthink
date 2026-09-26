import Link from "next/link";
import { notFound } from "next/navigation";
import { startExam } from "@/app/actions/attempts";
import { ActionForm } from "@/components/ActionForm";
import { AppShell } from "@/components/AppShell";
import { Card } from "@/components/ui";
import { END_REASON_LABEL, type StudentExamInfo } from "@/lib/attempts";
import { requireRole } from "@/lib/auth";
import { KIND_LABEL } from "@/lib/exams";
import { createClient } from "@/lib/supabase/server";
import { formatManila } from "@/lib/time";

export default async function StudentExamPage({ params }: { params: Promise<{ examId: string }> }) {
  const { examId } = await params;
  const profile = await requireRole("student");
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("student_exam_info", { p_exam_id: examId });
  if (error || !data) notFound();
  const exam = data as StudentExamInfo;
  const attempt = exam.attempt;
  const submitted = !!attempt?.submitted_at;
  const inProgress = !!attempt && !submitted;

  return (
    <AppShell profile={profile}>
      <Link href="/student" className="text-sm font-medium text-emerald-700">
        ← My classes
      </Link>

      <div>
        <p className="text-xs font-semibold uppercase text-slate-500">{KIND_LABEL[exam.kind] ?? exam.kind}</p>
        <h1 className="text-2xl font-bold">{exam.title}</h1>
      </div>

      {submitted ? (
        <Card className="space-y-2 text-center">
          <p className="text-sm font-semibold uppercase tracking-wide text-emerald-700">Submitted</p>
          {attempt!.score !== null && attempt!.max_score !== null ? (
            <>
              <p className="text-5xl font-bold">
                {Number(attempt!.score)}
                <span className="text-2xl text-slate-400"> / {Number(attempt!.max_score)}</span>
              </p>
              <p className="text-slate-600">
                {Math.round((Number(attempt!.score) / Math.max(Number(attempt!.max_score), 1)) * 100)}%
              </p>
            </>
          ) : (
            <p className="text-slate-600">Your instructor will release the scores.</p>
          )}
          <p className="text-xs text-slate-500">
            {attempt!.end_reason && attempt!.end_reason !== "student"
              ? `${END_REASON_LABEL[attempt!.end_reason] ?? attempt!.end_reason} · `
              : "Submitted "}
            {formatManila(attempt!.submitted_at)}
          </p>
        </Card>
      ) : (
        <>
          <Card className="space-y-3">
            <dl className="grid grid-cols-2 gap-3 text-sm">
              <div>
                <dt className="text-slate-500">Questions</dt>
                <dd className="text-lg font-semibold">{exam.item_count}</dd>
              </div>
              <div>
                <dt className="text-slate-500">Time limit</dt>
                <dd className="text-lg font-semibold">{exam.time_limit_minutes} min</dd>
              </div>
              {exam.opens_at && (
                <div>
                  <dt className="text-slate-500">Opens</dt>
                  <dd className="font-medium">{formatManila(exam.opens_at)}</dd>
                </div>
              )}
              {exam.closes_at && (
                <div>
                  <dt className="text-slate-500">Closes</dt>
                  <dd className="font-medium">{formatManila(exam.closes_at)}</dd>
                </div>
              )}
            </dl>
            {exam.instructions && (
              <div className="rounded-xl bg-slate-50 p-3">
                <p className="mb-1 text-sm font-semibold">Instructions</p>
                <p className="whitespace-pre-line text-sm text-slate-700">{exam.instructions}</p>
              </div>
            )}
          </Card>

          {inProgress ? (
            <Card className="space-y-3">
              <p className="text-sm text-slate-700">
                You started this exam. Your time keeps running until {formatManila(attempt!.deadline_at)}.
              </p>
              <Link
                href={`/student/attempts/${attempt!.id}`}
                className="block rounded-xl bg-emerald-700 px-4 py-4 text-center text-lg font-semibold text-white"
              >
                Continue exam
              </Link>
            </Card>
          ) : exam.is_open ? (
            <Card className="space-y-3">
              <ul className="list-disc space-y-1 pl-5 text-sm text-slate-700">
                <li>The timer starts when you tap Start and does not stop if you leave.</li>
                <li>Your answers save automatically as you go.</li>
                <li>You can take this exam only once, on one device at a time.</li>
                <li>
                  Leaving the exam screen (switching apps or tabs) is recorded
                  {exam.leave_limit !== null
                    ? `. After ${exam.leave_limit} times, your exam is submitted automatically.`
                    : " and shown to your instructor."}
                </li>
              </ul>
              <ActionForm action={startExam} submitLabel="Start exam" pendingLabel="Starting…" className="space-y-3">
                <input type="hidden" name="exam_id" value={exam.id} />
                {exam.require_access_code && (
                  <label className="block">
                    <span className="mb-1 block text-sm font-medium text-slate-700">
                      Access code (shown by your instructor)
                    </span>
                    <input
                      name="code"
                      inputMode="numeric"
                      autoComplete="one-time-code"
                      maxLength={6}
                      placeholder="000000"
                      required
                      className="block w-full rounded-xl border-2 border-slate-300 px-3 py-3 text-center font-mono text-2xl tracking-[0.4em] outline-none focus:border-emerald-600"
                    />
                  </label>
                )}
              </ActionForm>
            </Card>
          ) : (
            <Card>
              <p className="text-center text-slate-600">
                {exam.status === "closed" || (exam.closes_at && new Date(exam.closes_at) <= new Date(exam.server_now))
                  ? "This exam is closed."
                  : "This exam hasn't opened yet."}
              </p>
            </Card>
          )}
        </>
      )}
    </AppShell>
  );
}
