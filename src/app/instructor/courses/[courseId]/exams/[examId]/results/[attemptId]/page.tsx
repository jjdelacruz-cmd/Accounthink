import Link from "next/link";
import { notFound } from "next/navigation";
import { AppShell } from "@/components/AppShell";
import { Avatar } from "@/components/Avatar";
import { ScoreEditor } from "@/components/ScoreEditor";
import { Card } from "@/components/ui";
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
              className={`flex gap-2 rounded-lg px-2 py-1 text-sm ${
                correct ? "bg-emerald-50 font-semibold text-emerald-900" : picked ? "bg-red-50 text-red-900" : ""
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
        {given.length ? given.join("; ") : <span className="italic text-slate-500">blank</span>}
      </p>
      <p className="text-slate-600">
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
      <Link
        href={`/instructor/courses/${courseId}/exams/${examId}/results`}
        className="text-sm font-medium text-emerald-700"
      >
        ← {course.code} results
      </Link>

      <Card className="flex items-start justify-between gap-3">
        <Avatar name={r.student.full_name} src={r.student.avatar} size={56} />
        <div className="min-w-0 flex-1">
          <h1 className="text-xl font-bold">{r.student.full_name || "—"}</h1>
          <p className="text-sm text-slate-500">
            {[r.student.student_no, r.student.email, a.device].filter(Boolean).join(" · ")}
          </p>
          <p className="mt-1 text-xs text-slate-500">
            Started {formatManila(a.started_at)}
            {done && ` · ${END_REASON_LABEL[a.end_reason ?? "student"] ?? a.end_reason} ${formatManila(a.submitted_at)}`}
          </p>
        </div>
        {done && (
          <div className="shrink-0 text-right">
            <p className="text-2xl font-bold">
              {Number(a.score)}
              <span className="text-base text-slate-400"> / {Number(a.max_score)}</span>
            </p>
            <p className="text-sm text-slate-600">{round1(pct(Number(a.score), Number(a.max_score)))}%</p>
          </div>
        )}
      </Card>
      {!done && <p className="text-sm text-amber-800">Still in progress: answers so far, not graded yet.</p>}
      {done && a.pending > 0 && (
        <p className="rounded-xl bg-amber-50 px-3 py-2 text-sm text-amber-900">
          {a.pending} answer{a.pending === 1 ? "" : "s"} to check. Score each one below; the total updates as you go.
        </p>
      )}

      <ol className="space-y-2">
        {r.items.map((it) => {
          // No saved answer = 0; a saved answer with no points = waiting to be checked.
          const earned = it.points_awarded === null ? (it.answer ? null : 0) : Number(it.points_awarded);
          const full = earned !== null && earned >= Number(it.points);
          const partial = earned !== null && earned > 0 && !full;
          const toCheck = done && earned === null;
          return (
            <li
              key={it.item_id}
              className={`space-y-2 rounded-xl border bg-white p-3 ${
                !done || toCheck ? "border-slate-200" : full ? "border-emerald-200" : partial ? "border-amber-200" : "border-red-200"
              }`}
            >
              <div className="flex items-start justify-between gap-2">
                <p className="text-xs font-semibold text-slate-500">
                  {it.index}. {ITEM_TYPE_LABEL[it.type]}
                </p>
                {done && (
                  <span
                    className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-bold ${
                      toCheck
                        ? "bg-amber-100 text-amber-900"
                        : full
                          ? "bg-emerald-100 text-emerald-800"
                          : partial
                            ? "bg-amber-100 text-amber-900"
                            : "bg-red-100 text-red-800"
                    }`}
                  >
                    {toCheck ? `To check · ${Number(it.points)} pts` : `${full ? "✓" : partial ? "½" : "✗"} ${earned ?? 0}/${Number(it.points)}`}
                    {it.manual && ` · by ${it.checked_by_name ?? "you"}`}
                  </span>
                )}
              </div>
              <p className="whitespace-pre-line">{it.stem}</p>
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
