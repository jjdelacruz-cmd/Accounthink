import Link from "next/link";
import { notFound } from "next/navigation";
import {
  deleteExam,
  moveExamItem,
  removeExamItem,
  setExamStatus,
  updateExamSettings,
} from "@/app/actions/exams";
import { ActionForm } from "@/components/ActionForm";
import { AppShell } from "@/components/AppShell";
import { ExamItemPicker, type PickerItem } from "@/components/ExamItemPicker";
import { ExamStatusBadge } from "@/components/ExamStatusBadge";
import { Card, Field } from "@/components/ui";
import { getOwnedCourse } from "@/lib/courses";
import { KIND_LABEL } from "@/lib/exams";
import { DIFFICULTY_LABEL, ITEM_TYPE_LABEL, type Difficulty, type ItemType } from "@/lib/items";
import { isoToManilaInput } from "@/lib/time";

type Exam = {
  id: string;
  title: string;
  kind: string;
  instructions: string | null;
  time_limit_minutes: number | null;
  opens_at: string | null;
  closes_at: string | null;
  status: "draft" | "published" | "closed";
  shuffle_items: boolean;
  shuffle_choices: boolean;
  show_score: boolean;
  require_access_code: boolean;
  leave_limit: number | null;
};

type ExamItemRow = {
  position: number;
  items: { id: string; type: ItemType; stem: string; topic: string | null; difficulty: Difficulty; points: number };
};

const inputCls = "block w-full rounded-xl border border-slate-300 bg-white px-3 py-3 text-base";
const labelCls = "mb-1 block text-sm font-medium text-slate-700";

export default async function ExamBuilderPage({
  params,
}: {
  params: Promise<{ courseId: string; examId: string }>;
}) {
  const { courseId, examId } = await params;
  const { profile, supabase, course } = await getOwnedCourse(courseId);

  const { data: examData } = await supabase
    .from("exams")
    .select(
      "id, title, kind, instructions, time_limit_minutes, opens_at, closes_at, status, shuffle_items, shuffle_choices, show_score, require_access_code, leave_limit",
    )
    .eq("id", examId)
    .eq("course_id", courseId)
    .maybeSingle();
  if (!examData) notFound();
  const exam = examData as Exam;
  const isDraft = exam.status === "draft";

  const [{ data: sectionData }, { data: assigned }, { data: examItemData }, { data: bankData }] = await Promise.all([
    supabase.from("sections").select("id, name").eq("course_id", courseId).order("name"),
    supabase.from("exam_sections").select("section_id").eq("exam_id", examId),
    supabase
      .from("exam_items")
      .select("position, items(id, type, stem, topic, difficulty, points)")
      .eq("exam_id", examId)
      .order("position"),
    supabase
      .from("items")
      .select("id, type, stem, topic, difficulty, points")
      .eq("course_id", courseId)
      .eq("archived", false)
      .order("created_at", { ascending: false }),
  ]);
  // Close out anyone whose time ran out so the counts are current.
  if (!isDraft) await supabase.rpc("finalize_expired_for_exam", { p_exam_id: examId });
  const { data: attemptRows } = await supabase.from("attempts").select("submitted_at").eq("exam_id", examId);
  const started = attemptRows?.length ?? 0;
  const submitted = attemptRows?.filter((a) => a.submitted_at).length ?? 0;

  const sections = sectionData ?? [];
  const assignedIds = new Set((assigned ?? []).map((r) => r.section_id as string));
  const examItems = (examItemData ?? []) as unknown as ExamItemRow[];
  const inExam = new Set(examItems.map((r) => r.items.id));
  const bank = ((bankData ?? []) as PickerItem[]).filter((i) => !inExam.has(i.id));

  const totalPoints = examItems.reduce((sum, r) => sum + Number(r.items.points), 0);
  const counts = examItems.reduce<Record<string, number>>((acc, r) => {
    acc[r.items.type] = (acc[r.items.type] ?? 0) + 1;
    return acc;
  }, {});
  const hidden = (
    <>
      <input type="hidden" name="exam_id" value={examId} />
      <input type="hidden" name="course_id" value={courseId} />
    </>
  );

  return (
    <AppShell profile={profile}>
      <Link href={`/instructor/courses/${courseId}/exams`} className="text-sm font-medium text-emerald-700">
        ← {course.code} exams
      </Link>

      <div className="flex items-start justify-between gap-2">
        <div>
          <p className="text-xs font-semibold uppercase text-slate-500">{KIND_LABEL[exam.kind] ?? exam.kind}</p>
          <h1 className="text-xl font-bold">{exam.title}</h1>
          <p className="text-sm text-slate-600">
            {examItems.length} items · {totalPoints} points
            {Object.keys(counts).length > 0 &&
              ` (${Object.entries(counts)
                .map(([t, n]) => `${n} ${ITEM_TYPE_LABEL[t as ItemType].toLowerCase()}`)
                .join(", ")})`}
          </p>
        </div>
        <ExamStatusBadge status={exam.status} />
      </div>

      {!isDraft && (
        <Link
          href={`/instructor/courses/${courseId}/exams/${examId}/monitor`}
          className="block rounded-xl bg-slate-900 px-4 py-4 text-center text-lg font-semibold text-white"
        >
          Open live monitor →
        </Link>
      )}

      {/* Status */}
      <Card className="space-y-2">
        {isDraft ? (
          <>
            <p className="text-sm font-semibold">Ready to publish?</p>
            <ul className="space-y-1 text-sm">
              {(
                [
                  [!!exam.time_limit_minutes, "Time limit set"],
                  [assignedIds.size > 0, "At least one section ticked and saved"],
                  [examItems.length > 0, "At least one item added"],
                ] as const
              ).map(([ok, text]) => (
                <li key={text} className={ok ? "text-emerald-800" : "text-slate-500"}>
                  {ok ? "✓" : "○"} {text}
                </li>
              ))}
            </ul>
            <p className="text-sm text-slate-600">
              Set these in <b>Settings</b> and <b>Items</b> below, then tap <b>Save &amp; publish</b>. Items are
              locked while published.
            </p>
          </>
        ) : (
          <div className="grid gap-2 sm:grid-cols-2">
            {exam.status === "published" && (
              <ActionForm action={setExamStatus} submitLabel="Close exam" className="space-y-2">
                {hidden}
                <input type="hidden" name="status" value="closed" />
              </ActionForm>
            )}
            {exam.status === "closed" && (
              <ActionForm action={setExamStatus} submitLabel="Reopen (publish)" className="space-y-2">
                {hidden}
                <input type="hidden" name="status" value="published" />
              </ActionForm>
            )}
            {started === 0 && (
              <ActionForm action={setExamStatus} submitLabel="Back to draft (edit items)" className="space-y-2">
                {hidden}
                <input type="hidden" name="status" value="draft" />
              </ActionForm>
            )}
          </div>
        )}
        {!isDraft && (
          <p className="text-sm text-slate-600">
            <b>{started}</b> student{started === 1 ? "" : "s"} started · <b>{submitted}</b> submitted
            {started > 0 && " · items are now locked for good"}
          </p>
        )}
      </Card>

      {/* Settings */}
      <Card>
        <h2 className="mb-3 font-semibold">Settings</h2>
        <ActionForm
          action={updateExamSettings}
          submitLabel="Save settings"
          resetOnSuccess={false}
          secondarySubmit={isDraft ? { label: "Save & publish", name: "intent", value: "publish" } : undefined}
        >
          {hidden}
          <Field label="Title" name="title" defaultValue={exam.title} required />
          <div className="grid grid-cols-2 gap-3">
            <label className="block">
              <span className={labelCls}>Type</span>
              <select name="kind" defaultValue={exam.kind} className={inputCls}>
                {Object.entries(KIND_LABEL).map(([v, l]) => (
                  <option key={v} value={v}>{l}</option>
                ))}
              </select>
            </label>
            <Field
              label="Time limit (minutes)"
              name="time_limit_minutes"
              type="number"
              inputMode="numeric"
              min={1}
              max={600}
              defaultValue={exam.time_limit_minutes ?? ""}
            />
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field
              label="Opens (PH time)"
              name="opens_at"
              type="datetime-local"
              defaultValue={isoToManilaInput(exam.opens_at)}
            />
            <Field
              label="Closes (PH time)"
              name="closes_at"
              type="datetime-local"
              defaultValue={isoToManilaInput(exam.closes_at)}
            />
          </div>
          <p className="-mt-1 text-xs text-slate-500">Leave blank to open/close manually with the buttons above.</p>
          <label className="block">
            <span className={labelCls}>Instructions for students</span>
            <textarea name="instructions" rows={3} defaultValue={exam.instructions ?? ""} className={inputCls} />
          </label>

          <fieldset>
            <legend className={labelCls}>Sections taking this exam</legend>
            {sections.length === 0 ? (
              <p className="text-sm text-slate-500">No sections yet. Add one from My courses.</p>
            ) : (
              <div className="grid grid-cols-2 gap-2">
                {sections.map((s) => (
                  <label key={s.id} className="flex items-center gap-2 rounded-xl border border-slate-200 px-3 py-3">
                    <input
                      type="checkbox"
                      name="section_ids"
                      value={s.id}
                      defaultChecked={assignedIds.has(s.id)}
                      className="h-5 w-5 accent-emerald-700"
                    />
                    <span className="font-medium">{s.name}</span>
                  </label>
                ))}
              </div>
            )}
          </fieldset>

          <fieldset className="space-y-2">
            <legend className={labelCls}>Options</legend>
            {(
              [
                ["shuffle_items", "Shuffle question order per student", exam.shuffle_items],
                ["shuffle_choices", "Shuffle multiple-choice options per student", exam.shuffle_choices],
                ["show_score", "Show score to students after submitting", exam.show_score],
                [
                  "require_access_code",
                  "Require the rotating access code to start (shown on the live monitor)",
                  exam.require_access_code,
                ],
              ] as const
            ).map(([name, text, on]) => (
              <label key={name} className="flex items-center gap-2 text-sm">
                <input type="checkbox" name={name} defaultChecked={on} className="h-5 w-5 accent-emerald-700" />
                {text}
              </label>
            ))}
          </fieldset>
          <Field
            label="Auto-submit after leaving the exam this many times (blank = never)"
            name="leave_limit"
            type="number"
            inputMode="numeric"
            min={1}
            max={50}
            defaultValue={exam.leave_limit ?? ""}
          />
        </ActionForm>
      </Card>

      {/* Items */}
      <Card className="space-y-3">
        <h2 className="font-semibold">Items in this exam</h2>
        {examItems.length === 0 && <p className="text-sm text-slate-500">No items yet. Add from the bank below.</p>}
        <ol className="divide-y divide-slate-100">
          {examItems.map((r, i) => (
            <li key={r.items.id} className="flex items-start gap-2 py-2">
              <span className="w-7 shrink-0 pt-0.5 text-right font-semibold text-slate-500">{i + 1}.</span>
              <div className="min-w-0 flex-1">
                <p className="line-clamp-2 text-sm">{r.items.stem}</p>
                <p className="text-xs text-slate-500">
                  {ITEM_TYPE_LABEL[r.items.type]} · {DIFFICULTY_LABEL[r.items.difficulty]} · {Number(r.items.points)} pt
                  {r.items.topic ? ` · ${r.items.topic}` : ""}
                </p>
              </div>
              {isDraft && (
                <div className="flex shrink-0 items-center">
                  {(["up", "down"] as const).map((dir) => (
                    <form key={dir} action={moveExamItem}>
                      {hidden}
                      <input type="hidden" name="item_id" value={r.items.id} />
                      <input type="hidden" name="dir" value={dir} />
                      <button
                        aria-label={`Move ${dir}`}
                        disabled={(dir === "up" && i === 0) || (dir === "down" && i === examItems.length - 1)}
                        className="rounded-lg px-2 py-2 text-slate-600 disabled:opacity-25"
                      >
                        {dir === "up" ? "↑" : "↓"}
                      </button>
                    </form>
                  ))}
                  <form action={removeExamItem}>
                    {hidden}
                    <input type="hidden" name="item_id" value={r.items.id} />
                    <button aria-label="Remove from exam" className="rounded-lg px-2 py-2 text-red-600">
                      ✕
                    </button>
                  </form>
                </div>
              )}
            </li>
          ))}
        </ol>
      </Card>

      {isDraft && (
        <Card className="space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="font-semibold">Add from item bank</h2>
            <Link
              href={`/instructor/courses/${courseId}/items/new`}
              className="text-sm font-semibold text-emerald-700"
            >
              + New item
            </Link>
          </div>
          <ExamItemPicker examId={examId} courseId={courseId} items={bank} />
        </Card>
      )}

      {isDraft && (
        <form action={deleteExam} className="pt-2 text-center">
          {hidden}
          <button className="text-sm font-medium text-red-600">Delete this draft exam</button>
        </form>
      )}
    </AppShell>
  );
}
