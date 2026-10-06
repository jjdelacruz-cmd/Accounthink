import Link from "next/link";
import { notFound } from "next/navigation";
import { AppShell } from "@/components/AppShell";
import { ScoreEditor } from "@/components/ScoreEditor";
import { Card } from "@/components/ui";
import { getOwnedCourse } from "@/lib/courses";
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
  if (!parts.length) return <p className="text-sm italic text-slate-500">Left blank</p>;
  if (type === "enumeration")
    return (
      <ol className="list-decimal pl-5 text-sm">
        {parts.map((p, i) => (
          <li key={i}>{p}</li>
        ))}
      </ol>
    );
  return <p className="whitespace-pre-line text-sm leading-relaxed">{parts[0]}</p>;
}

export default async function CheckAnswersPage({
  params,
  searchParams,
}: {
  params: Promise<{ courseId: string; examId: string }>;
  searchParams: Promise<{ item?: string; show?: string }>;
}) {
  const { courseId, examId } = await params;
  const sp = await searchParams;
  const { profile, supabase, course } = await getOwnedCourse(courseId);
  const { data: exam } = await supabase
    .from("exams")
    .select("id, title")
    .eq("id", examId)
    .eq("course_id", courseId)
    .maybeSingle();
  if (!exam) notFound();

  const { data: summaryData, error } = await supabase.rpc("exam_check_summary", { p_exam_id: examId });
  const summary = (summaryData ?? []) as SummaryItem[];
  const totalPending = summary.reduce((n, s) => n + Number(s.pending), 0);
  const current =
    summary.find((s) => s.item_id === sp.item) ?? summary.find((s) => Number(s.pending) > 0) ?? summary[0];
  const show: Show = sp.show && sp.show in SHOW ? (sp.show as Show) : current?.type === "essay" ? "all" : "wrong";

  let detail: CheckItem | null = null;
  if (current) {
    const { data } = await supabase.rpc("exam_check_item", { p_exam_id: examId, p_item_id: current.item_id });
    detail = data as CheckItem | null;
  }
  const base = `/instructor/courses/${courseId}/exams/${examId}/check`;
  const shown = (detail?.answers ?? []).filter((a) =>
    show === "todo" ? a.points_awarded === null : show === "wrong" ? Number(a.points_awarded ?? 0) < Number(detail!.item.points) || a.points_awarded === null : true,
  );

  return (
    <AppShell profile={profile}>
      <Link href={`/instructor/courses/${courseId}/exams/${examId}`} className="text-sm font-medium text-emerald-700">
        ← {course.code} · {exam.title}
      </Link>
      <div>
        <h1 className="text-xl font-bold">Check answers</h1>
        <p className="text-sm text-slate-600">
          {totalPending > 0
            ? `${totalPending} answer${totalPending === 1 ? "" : "s"} waiting to be checked.`
            : "Nothing waiting. You can still change any score below."}{" "}
          Multiple choice is always graded by the key.
        </p>
      </div>

      {error && <p className="rounded-xl bg-red-50 p-3 text-red-800">{error.message}</p>}
      {!error && summary.length === 0 && (
        <Card>
          <p className="text-sm text-slate-600">
            This exam has only multiple-choice questions, so there is nothing to check by hand.
          </p>
        </Card>
      )}

      {summary.length > 0 && (
        <nav className="flex gap-2 overflow-x-auto pb-1" aria-label="Questions">
          {summary.map((s) => {
            const active = s.item_id === current?.item_id;
            return (
              <Link
                key={s.item_id}
                href={`${base}?item=${s.item_id}`}
                className={`shrink-0 rounded-xl border px-3 py-2 text-left text-xs ${
                  active ? "border-emerald-600 bg-emerald-50" : "border-slate-200 bg-white"
                }`}
              >
                <span className="block font-bold">
                  Q{s.position} · {ITEM_TYPE_LABEL[s.type]}
                </span>
                <span className={Number(s.pending) > 0 ? "font-semibold text-amber-700" : "text-slate-500"}>
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
            <p className="text-xs font-semibold text-slate-500">
              Question {current.position} · {ITEM_TYPE_LABEL[detail.item.type]} · {Number(detail.item.points)} pt
              {Number(detail.item.points) === 1 ? "" : "s"}
            </p>
            <p className="whitespace-pre-line">{detail.item.stem}</p>
            <p className="rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-900">
              <span className="font-semibold">{detail.item.type === "essay" ? "Your guide:" : "Key:"}</span>{" "}
              {keyText({ type: detail.item.type, key: detail.item.key, choices: null })}
            </p>
          </Card>

          <div className="flex gap-1 rounded-xl bg-slate-200/70 p-1">
            {(Object.keys(SHOW) as Show[]).map((k) => (
              <Link
                key={k}
                href={`${base}?item=${current.item_id}&show=${k}`}
                className={`flex-1 rounded-lg px-2 py-2 text-center text-xs font-semibold ${
                  show === k ? "bg-white text-emerald-800 shadow-sm" : "text-slate-600"
                }`}
              >
                {SHOW[k]}
              </Link>
            ))}
          </div>

          {shown.length === 0 && (
            <p className="text-center text-sm text-slate-600">
              {detail.answers.length === 0 ? "No one has submitted yet." : "No answers in this view."}
            </p>
          )}

          <ul className="space-y-2">
            {shown.map((a) => (
              <li key={a.attempt_id} className="space-y-2 rounded-xl border border-slate-200 bg-white p-3">
                <div className="flex items-start justify-between gap-2">
                  <Link
                    href={`/instructor/courses/${courseId}/exams/${examId}/results/${a.attempt_id}`}
                    className="font-semibold text-slate-900"
                  >
                    {a.full_name || "—"}
                    {a.student_no && <span className="font-normal text-slate-500"> · {a.student_no}</span>}
                  </Link>
                  <span
                    className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-bold ${
                      a.points_awarded === null
                        ? "bg-amber-100 text-amber-900"
                        : Number(a.points_awarded) >= Number(detail!.item.points)
                          ? "bg-emerald-100 text-emerald-800"
                          : Number(a.points_awarded) > 0
                            ? "bg-amber-100 text-amber-900"
                            : "bg-red-100 text-red-800"
                    }`}
                  >
                    {a.points_awarded === null
                      ? "To check"
                      : `${Number(a.points_awarded)}/${Number(detail!.item.points)}`}
                  </span>
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
                />
              </li>
            ))}
          </ul>
        </>
      )}
    </AppShell>
  );
}
