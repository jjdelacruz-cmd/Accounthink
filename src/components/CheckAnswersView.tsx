import Link from "next/link";
import { ScoreEditor } from "@/components/ScoreEditor";
import { Badge, Card, EmptyState, Notice, PageTitle } from "@/components/ui";
import { createClient } from "@/lib/supabase/server";
import { ITEM_TYPE_LABEL, type Answer, type ItemType } from "@/lib/items";
import { keyText } from "@/lib/results";

type SummaryItem = {
  position: number;
  item_id: string;
  type: ItemType;
  stem: string;
  points: number;
  answered: number;
  pending: number;
  checked: number;
};

type CheckAnswer = {
  attempt_id: string;
  full_name: string;
  student_no: string | null;
  answer: { text?: string; items?: string[] } | null;
  points_awarded: number | null;
  manual: boolean;
  comment: string | null;
  checked_by_name: string | null;
};

type CheckItem = {
  item: { item_id: string; type: ItemType; stem: string; points: number; key: Answer | null };
  answers: CheckAnswer[];
};

const SHOW = {
  all: "All answers",
  todo: "Not checked",
  wrong: "Not full marks",
} as const;
type Show = keyof typeof SHOW;

function AnswerText({ type, answer }: { type: ItemType; answer: CheckAnswer["answer"] }) {
  const parts =
    type === "enumeration" ? (answer?.items ?? []).filter((x) => x.trim()) : answer?.text?.trim() ? [answer.text] : [];
  if (!parts.length) return <p className="text-sm italic text-ink-600">Left blank</p>;
  if (type === "enumeration")
    return (
      <ol className="list-decimal pl-5 text-sm">
        {parts.map((p, i) => (
          <li key={i}>{p}</li>
        ))}
      </ol>
    );
  return <p className="whitespace-pre-line rounded-chip bg-ink-50 px-3 py-2 text-base leading-relaxed text-ink-900">{parts[0]}</p>;
}

/** The whole "check answers" screen. Used by the instructor and by assigned checkers. */
export async function CheckAnswersView({
  examId,
  courseId,
  base,
  item,
  show: showParam,
  linkStudents,
}: {
  examId: string;
  courseId: string;
  /** Path of the page that shows this view; links add ?item= and &show= to it. */
  base: string;
  item?: string;
  show?: string;
  /** Link student names to the instructor's full review (not for checkers). */
  linkStudents: boolean;
}) {
  const supabase = await createClient();
  const { data: summaryData, error } = await supabase.rpc("exam_check_summary", { p_exam_id: examId });
  const summary = (summaryData ?? []) as SummaryItem[];
  const totalPending = summary.reduce((n, s) => n + Number(s.pending), 0);
  const current = summary.find((s) => s.item_id === item) ?? summary.find((s) => Number(s.pending) > 0) ?? summary[0];
  const show: Show = showParam && showParam in SHOW ? (showParam as Show) : current?.type === "essay" ? "all" : "wrong";

  let detail: CheckItem | null = null;
  if (current) {
    const { data } = await supabase.rpc("exam_check_item", { p_exam_id: examId, p_item_id: current.item_id });
    detail = data as CheckItem | null;
  }
  const shown = (detail?.answers ?? []).filter((a) =>
    show === "todo"
      ? a.points_awarded === null
      : show === "wrong"
        ? Number(a.points_awarded ?? 0) < Number(detail!.item.points) || a.points_awarded === null
        : true,
  );

  return (
    <>
      <div className="space-y-1">
        <PageTitle>Check answers</PageTitle>
        <p className="text-sm text-ink-600">
          {totalPending > 0
            ? `${totalPending} answer${totalPending === 1 ? "" : "s"} waiting to be checked.`
            : "Nothing waiting. You can still change any score below."}{" "}
          Multiple choice is always graded by the key.
        </p>
      </div>

      {error && <Notice kind="error">{error.message}</Notice>}
      {!error && summary.length === 0 && (
        <EmptyState icon="check" title="Nothing to check by hand">
          This exam has only multiple-choice questions, so there is nothing to check by hand.
        </EmptyState>
      )}

      {summary.length > 0 && (
        <nav className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1" aria-label="Questions">
          {summary.map((s) => {
            const active = s.item_id === current?.item_id;
            return (
              <Link
                key={s.item_id}
                href={`${base}?item=${s.item_id}`}
                aria-current={active ? "page" : undefined}
                className={`shrink-0 rounded-control border px-3 py-2 text-left text-xs ${
                  active ? "border-brand-600 bg-brand-50 ring-1 ring-brand-600" : "border-ink-300 bg-white hover:bg-ink-50"
                }`}
              >
                <span className="block font-bold">
                  Q{s.position} · {ITEM_TYPE_LABEL[s.type]}
                </span>
                <span className={Number(s.pending) > 0 ? "font-semibold text-warning-800" : "text-ink-600"}>
                  {Number(s.pending) > 0 ? `${s.pending} to check` : `${s.answered} answered`}
                </span>
              </Link>
            );
          })}
        </nav>
      )}

      {detail && current && (
        <>
          <Card className="space-y-2">
            <p className="text-xs font-semibold text-ink-600">
              Question {current.position} · {ITEM_TYPE_LABEL[detail.item.type]} · {Number(detail.item.points)} pt
              {Number(detail.item.points) === 1 ? "" : "s"}
            </p>
            <p className="whitespace-pre-line text-base text-ink-900">{detail.item.stem}</p>
            <p className="rounded-control bg-brand-50 px-3 py-2 text-sm text-brand-900">
              <span className="font-semibold">{detail.item.type === "essay" ? "Your guide:" : "Key:"}</span>{" "}
              {detail.item.type === "essay"
                ? (detail.item.key as { guide?: string } | null)?.guide || "no guide written"
                : keyText({ type: detail.item.type, key: detail.item.key, choices: null })}
            </p>
          </Card>

          <div className="tabs grid-cols-3">
            {(Object.keys(SHOW) as Show[]).map((k) => (
              <Link
                key={k}
                href={`${base}?item=${current.item_id}&show=${k}`}
                aria-current={show === k ? "page" : undefined}
                className="tab text-center text-xs"
              >
                {SHOW[k]}
              </Link>
            ))}
          </div>

          {shown.length === 0 && (
            <p className="text-center text-sm text-ink-600">
              {detail.answers.length === 0 ? "No one has submitted yet." : "No answers in this view."}
            </p>
          )}

          <ul className="space-y-3">
            {shown.map((a) => (
              <li key={a.attempt_id} className="card space-y-3 !p-3 sm:!p-4">
                <div className="flex items-start justify-between gap-2">
                  {linkStudents ? (
                    <Link
                      href={`/instructor/courses/${courseId}/exams/${examId}/results/${a.attempt_id}`}
                      className="font-semibold text-ink-900"
                    >
                      {a.full_name || "—"}
                      {a.student_no && <span className="font-normal text-ink-600"> · {a.student_no}</span>}
                    </Link>
                  ) : (
                    <span className="font-semibold text-ink-900">
                      {a.full_name || "—"}
                      {a.student_no && <span className="font-normal text-ink-600"> · {a.student_no}</span>}
                    </span>
                  )}
                  <Badge
                    tone={
                      a.points_awarded === null
                        ? "warning"
                        : Number(a.points_awarded) >= Number(detail!.item.points)
                          ? "success"
                          : Number(a.points_awarded) > 0
                            ? "warning"
                            : "danger"
                    }
                    className="shrink-0 tabular-nums"
                  >
                    {a.points_awarded === null
                      ? "To check"
                      : `${Number(a.points_awarded)}/${Number(detail!.item.points)}`}
                  </Badge>
                </div>
                <AnswerText type={detail!.item.type} answer={a.answer} />
                <ScoreEditor
                  courseId={courseId}
                  examId={examId}
                  attemptId={a.attempt_id}
                  itemId={detail!.item.item_id}
                  type={detail!.item.type}
                  max={Number(detail!.item.points)}
                  points={a.points_awarded === null ? null : Number(a.points_awarded)}
                  manual={a.manual}
                  comment={a.comment}
                  scoredBy={a.checked_by_name}
                />
              </li>
            ))}
          </ul>
        </>
      )}
    </>
  );
}
