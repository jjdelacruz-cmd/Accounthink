import Link from "next/link";
import { notFound } from "next/navigation";
import { startExam } from "@/app/actions/attempts";
import { ActionForm } from "@/components/ActionForm";
import { AppShell } from "@/components/AppShell";
import { CameraGate } from "@/components/CameraMonitor";
import { ExamFeedback } from "@/components/ExamFeedback";
import { BackLink, Card, Notice, PageTitle, labelClass } from "@/components/ui";
import { END_REASON_LABEL, type ExamFeedback as Feedback, type StudentExamInfo } from "@/lib/attempts";
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
  const feedback = submitted
    ? ((await supabase.rpc("my_exam_feedback", { p_exam_id: examId })).data as Feedback | null)
    : null;

  const startForm = (
    <ActionForm action={startExam} submitLabel="Start exam" pendingLabel="Starting…" className="space-y-3">
      <input type="hidden" name="exam_id" value={exam.id} />
      {exam.require_access_code && (
        <label className="block">
          <span className={labelClass}>
            Access code (shown by your instructor)
          </span>
          <input
            name="code"
            inputMode="numeric"
            autoComplete="one-time-code"
            maxLength={6}
            placeholder="000000"
            required
            className="input !border-2 text-center font-mono text-2xl tracking-[0.4em]"
          />
        </label>
      )}
    </ActionForm>
  );

  return (
    <AppShell profile={profile}>
      <BackLink href="/student">My classes</BackLink>

      <PageTitle eyebrow={KIND_LABEL[exam.kind] ?? exam.kind}>{exam.title}</PageTitle>

      {submitted ? (
        <Card className="space-y-2 border-t-4 !border-t-brand-600 text-center">
          <p className="text-sm font-semibold uppercase tracking-wide text-brand-800">Submitted</p>
          {attempt!.score !== null && attempt!.max_score !== null ? (
            <>
              <p className="text-5xl font-bold tabular-nums text-ink-900">
                {Number(attempt!.score)}
                <span className="text-2xl text-ink-600"> / {Number(attempt!.max_score)}</span>
              </p>
              <p className="text-xl font-semibold tabular-nums text-brand-800">
                {Math.round((Number(attempt!.score) / Math.max(Number(attempt!.max_score), 1)) * 100)}%
              </p>
            </>
          ) : (
            <p className="text-ink-600">Your instructor will release the scores.</p>
          )}
          {attempt!.pending > 0 && (
            <Notice kind="warn" className="text-left">
              {attempt!.pending} answer{attempt!.pending === 1 ? " is" : "s are"} still being checked by your
              instructor{attempt!.score !== null ? ", so this score may go up" : ""}.
            </Notice>
          )}
          <p className="text-xs text-ink-600">
            {attempt!.end_reason && attempt!.end_reason !== "student"
              ? `${END_REASON_LABEL[attempt!.end_reason] ?? attempt!.end_reason} · `
              : "Submitted "}
            {formatManila(attempt!.submitted_at)}
          </p>
        </Card>
      ) : null}

      {submitted && feedback?.status === "ready" && (
        <ExamFeedback items={feedback.items} showAnswers={feedback.show_answers} />
      )}
      {submitted && feedback?.status === "after_close" && (
        <Card>
          <p className="text-center text-sm text-ink-600">
            You can review your right and wrong answers here after the exam closes
            {feedback.closes_at ? ` (${formatManila(feedback.closes_at)})` : ""}.
          </p>
        </Card>
      )}

      {submitted ? null : (
        <>
          <Card className="space-y-3">
            <dl className="grid grid-cols-2 gap-3 text-sm">
              <div>
                <dt className="text-ink-600">Questions</dt>
                <dd className="text-lg font-semibold tabular-nums">{exam.item_count}</dd>
              </div>
              <div>
                <dt className="text-ink-600">Time limit</dt>
                <dd className="text-lg font-semibold tabular-nums">{exam.time_limit_minutes} min</dd>
              </div>
              {exam.opens_at && (
                <div>
                  <dt className="text-ink-600">Opens</dt>
                  <dd className="font-medium">{formatManila(exam.opens_at)}</dd>
                </div>
              )}
              {exam.closes_at && (
                <div>
                  <dt className="text-ink-600">Closes</dt>
                  <dd className="font-medium">{formatManila(exam.closes_at)}</dd>
                </div>
              )}
            </dl>
            {exam.instructions && (
              <div className="rounded-control bg-ink-50 p-3">
                <p className="mb-1 text-sm font-semibold">Instructions</p>
                <p className="whitespace-pre-line text-sm text-ink-700">{exam.instructions}</p>
              </div>
            )}
          </Card>

          {inProgress ? (
            <Card className="space-y-3">
              <p className="text-sm text-ink-700">
                You started this exam. Your time keeps running until {formatManila(attempt!.deadline_at)}.
              </p>
              <Link
                href={`/student/attempts/${attempt!.id}`}
                className="btn btn-primary btn-lg btn-block"
              >
                Continue exam
              </Link>
            </Card>
          ) : exam.is_open ? (
            <Card className="space-y-3">
              <ul className="list-disc space-y-1 pl-5 text-sm text-ink-700">
                <li>The timer starts when you tap Start and does not stop if you leave.</li>
                <li>Your answers save automatically as you go.</li>
                {exam.require_camera && (
                  <li>
                    <b>This exam uses your front camera</b> to check that you stay in front of the screen. It runs only
                    on your phone: nothing is recorded or sent, only warnings (like looking away) are counted for your
                    instructor. You must allow the camera to start.
                  </li>
                )}
                <li>You can take this exam only once, on one device at a time.</li>
                <li>
                  Leaving the exam screen (switching apps or tabs) is recorded
                  {exam.leave_limit !== null
                    ? `. After ${exam.leave_limit} times, your exam is submitted automatically.`
                    : " and shown to your instructor."}
                </li>
              </ul>
              {exam.require_camera ? <CameraGate>{startForm}</CameraGate> : startForm}
            </Card>
          ) : (
            <Card>
              <p className="text-center text-ink-600">
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
