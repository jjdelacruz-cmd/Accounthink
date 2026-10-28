import { notFound } from "next/navigation";
import { AppShell } from "@/components/AppShell";
import { Avatar } from "@/components/Avatar";
import { ScoreEditor } from "@/components/ScoreEditor";
import { Badge, BackLink, Card, Notice, PageTitle } from "@/components/ui";
import { END_REASON_LABEL } from "@/lib/attempts";
import { getOwnedCourse } from "@/lib/courses";
import { CHOICE_KEYS, ITEM_TYPE_LABEL } from "@/lib/items";
import { keyText, pct, round1, type AttemptReview, type ReviewItem } from "@/lib/results";
import { formatManila } from "@/lib/time";

function StudentAnswer({ it }: { it: ReviewItem }) {
  const a = it.answer;
  if (it.type === "mcq") {
    return (
      <ul className="space-y-1">
        {it.choices?.map((c, i) => {
          const picked = a?.choice === c.key;
          const correct = it.key && "correct" in it.key && it.key.correct === c.key;
          return (
            <li
              key={c.key}
              className={`flex gap-2 rounded-chip px-2 py-1 text-sm ${
                correct ? "bg-brand-50 font-semibold text-brand-900" : picked ? "bg-danger-50 text-danger-900" : ""
              }`}
            >
              <span className="w-5 shrink-0">{CHOICE_KEYS[i]}.</span>
              <span className="flex-1">{c.text}</span>
              {picked && <span className="shrink-0 text-xs font-semibold">← their answer</span>}
              {correct && !picked && <span className="shrink-0 text-xs font-semibold">key</span>}
            </li>
          );
        })}
      </ul>
    );
  }
  const given = it.type === "enumeration" ? (a?.items ?? []).filter((x) => x.trim()) : a?.text?.trim() ? [a.text] : [];
  return (
    <div className="space-y-1 text-sm">
      <p className={it.type === "essay" ? "whitespace-pre-line" : ""}>
        <span className="font-semibold">Their answer:</span>
        {it.type === "essay" ? <br /> : " "}
        {given.length ? given.join("; ") : <span className="italic text-ink-600">blank</span>}
      </p>
      <p className="text-ink-600">
        <span className="font-semibold">{it.type === "essay" ? "Guide:" : "Key:"}</span> {keyText({ type: it.type, key: it.key, choices: it.choices })}
      </p>
    </div>
  );
}

export default async function AttemptReviewPage({
  params,
}: {
  params: Promise<{ courseId: string; examId: string; attemptId: string }>;
}) {
  const { courseId, examId, attemptId } = await params;
  const { profile, supabase, course } = await getOwnedCourse(courseId);
  const { data, error } = await supabase.rpc("attempt_review", { p_attempt_id: attemptId });
  if (error || !data) notFound();
  const r = data as AttemptReview;
  if (r.attempt.exam_id !== examId) notFound();
  const a = r.attempt;
  const done = !!a.submitted_at;

  return (
    <AppShell profile={profile}>
      <BackLink href={`/instructor/courses/${courseId}/exams/${examId}/results`}>{course.code} results</BackLink>

      <Card className="flex items-start gap-3">
        <Avatar name={r.student.full_name} src={r.student.avatar} size={56} />
        <div className="min-w-0 flex-1">
          <PageTitle>{r.student.full_name || "—"}</PageTitle>
          <p className="text-sm text-ink-600">
            {[r.student.student_no, r.student.email, a.device].filter(Boolean).join(" · ")}
          </p>
          <p className="mt-1 text-xs text-ink-600">
            Started {formatManila(a.started_at)}
            {done && ` · ${END_REASON_LABEL[a.end_reason ?? "student"] ?? a.end_reason} ${formatManila(a.submitted_at)}`}
          </p>
        </div>
        {done && (
          <div className="shrink-0 text-right">
            <p className="text-2xl font-bold tabular-nums">
              {Number(a.score)}
              <span className="text-base text-ink-600"> / {Number(a.max_score)}</span>
            </p>
            <p className="text-sm text-ink-600">{round1(pct(Number(a.score), Number(a.max_score)))}%</p>
          </div>
        )}
      </Card>
      {!done && <Notice kind="warn">Still in progress: answers so far, not graded yet.</Notice>}
      {done && a.pending > 0 && (
        <Notice kind="warn">
          {a.pending} answer{a.pending === 1 ? "" : "s"} to check. Score each one below; the total updates as you go.
        </Notice>
      )}

      <ol className="space-y-3">
        {r.items.map((it) => {
          // No saved answer = 0; a saved answer with no points = waiting to be checked.
          const earned = it.points_awarded === null ? (it.answer ? null : 0) : Number(it.points_awarded);
          const full = earned !== null && earned >= Number(it.points);
          const partial = earned !== null && earned > 0 && !full;
          const toCheck = done && earned === null;
          return (
            <li
              key={it.item_id}
              className={`card space-y-2 border-l-4 !p-3 sm:!p-4 ${
                !done || toCheck ? "border-l-ink-400" : full ? "border-l-brand-600" : partial ? "border-l-warning-500" : "border-l-danger-600"
              }`}
            >
              <div className="flex items-start justify-between gap-2">
                <p className="text-xs font-semibold text-ink-600">
                  {it.index}. {ITEM_TYPE_LABEL[it.type]}
                </p>
                {done && (
                  <Badge tone={toCheck ? "warning" : full ? "success" : partial ? "warning" : "danger"} className="shrink-0 tabular-nums">
                    {toCheck ? `To check · ${Number(it.points)} pts` : `${full ? "✓" : partial ? "½" : "✗"} ${earned ?? 0}/${Number(it.points)}`}
                    {it.manual && ` · by ${it.checked_by_name ?? "you"}`}
                  </Badge>
                )}
              </div>
              <p className="whitespace-pre-line text-base text-ink-900">{it.stem}</p>
              <StudentAnswer it={it} />
              {done && it.type !== "mcq" && (
                <ScoreEditor
                  courseId={courseId}
                  examId={examId}
                  attemptId={a.id}
                  itemId={it.item_id}
                  type={it.type}
                  max={Number(it.points)}
                  points={earned}
                  manual={it.manual}
                  comment={it.comment}
                  scoredBy={it.checked_by_name}
                />
              )}
            </li>
          );
        })}
      </ol>
    </AppShell>
  );
}
