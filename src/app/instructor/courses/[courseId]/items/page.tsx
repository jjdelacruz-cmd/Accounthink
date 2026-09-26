import Link from "next/link";
import { setItemArchived } from "@/app/actions/items";
import { AppShell } from "@/components/AppShell";
import { CourseNav } from "@/components/CourseNav";
import { DuplicateItemButton } from "@/components/DuplicateItemButton";
import { Card } from "@/components/ui";
import { getOwnedCourse } from "@/lib/courses";
import { getTopics } from "./topics";
import {
  DIFFICULTY_LABEL,
  ITEM_TYPE_LABEL,
  type Answer,
  type Choice,
  type Difficulty,
  type EnumerationAnswer,
  type IdentificationAnswer,
  type ItemType,
  type McqAnswer,
} from "@/lib/items";

type Row = {
  id: string;
  type: ItemType;
  stem: string;
  choices: Choice[] | null;
  topic: string | null;
  difficulty: Difficulty;
  points: number;
  archived: boolean;
  item_keys: { answer: Answer } | null;
};

function answerPreview(r: Row): string {
  const a = r.item_keys?.answer;
  if (!a) return "No key";
  if (r.type === "mcq") {
    const key = (a as McqAnswer).correct;
    const text = r.choices?.find((c) => c.key === key)?.text ?? "";
    return `${key}. ${text}`;
  }
  if (r.type === "identification") return (a as IdentificationAnswer).accepted.join(" / ");
  return (a as EnumerationAnswer).answers.map((alts) => alts[0]).join(", ");
}

export default async function ItemBankPage({
  params,
  searchParams,
}: {
  params: Promise<{ courseId: string }>;
  searchParams: Promise<{ q?: string; type?: string; topic?: string; difficulty?: string; archived?: string }>;
}) {
  const { courseId } = await params;
  const f = await searchParams;
  const { profile, supabase, course } = await getOwnedCourse(courseId);

  let query = supabase
    .from("items")
    .select("id, type, stem, choices, topic, difficulty, points, archived, item_keys(answer)")
    .eq("course_id", courseId)
    .eq("archived", f.archived === "1")
    .order("created_at", { ascending: false })
    .limit(300);
  if (f.type) query = query.eq("type", f.type);
  if (f.difficulty) query = query.eq("difficulty", f.difficulty);
  if (f.topic) query = query.eq("topic", f.topic);
  if (f.q) query = query.ilike("stem", `%${f.q.replace(/[%_]/g, "")}%`);
  const { data } = await query;
  const items = (data ?? []) as unknown as Row[];

  const topics = await getTopics(supabase, courseId);

  const select = "rounded-xl border border-slate-300 bg-white px-2 py-2 text-sm";

  return (
    <AppShell profile={profile}>
      <CourseNav course={course} active="items" />

      <Link
        href={`/instructor/courses/${courseId}/items/new`}
        className="block rounded-xl bg-emerald-700 px-4 py-3 text-center font-semibold text-white"
      >
        + New item
      </Link>

      <form className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <input
          name="q"
          defaultValue={f.q}
          placeholder="Search questions"
          className={`${select} col-span-2 sm:col-span-4`}
        />
        <select name="type" defaultValue={f.type ?? ""} className={select}>
          <option value="">All types</option>
          {Object.entries(ITEM_TYPE_LABEL).map(([v, l]) => (
            <option key={v} value={v}>{l}</option>
          ))}
        </select>
        <select name="difficulty" defaultValue={f.difficulty ?? ""} className={select}>
          <option value="">All levels</option>
          {Object.entries(DIFFICULTY_LABEL).map(([v, l]) => (
            <option key={v} value={v}>{l}</option>
          ))}
        </select>
        <select name="topic" defaultValue={f.topic ?? ""} className={select}>
          <option value="">All topics</option>
          {topics.map((t) => (
            <option key={t} value={t}>{t}</option>
          ))}
        </select>
        <select name="archived" defaultValue={f.archived ?? ""} className={select}>
          <option value="">Active</option>
          <option value="1">Archived</option>
        </select>
        <button className="col-span-2 rounded-xl border border-slate-300 bg-white py-2 text-sm font-semibold sm:col-span-4">
          Apply filters
        </button>
      </form>

      <p className="text-sm text-slate-600">
        {items.length} item{items.length === 1 ? "" : "s"}
        {items.length === 300 ? " (showing first 300)" : ""}
      </p>

      {items.map((r) => (
        <Card key={r.id} className="space-y-2">
          <div className="flex flex-wrap gap-1 text-xs font-semibold">
            <span className="rounded-md bg-emerald-50 px-2 py-0.5 text-emerald-800">{ITEM_TYPE_LABEL[r.type]}</span>
            <span className="rounded-md bg-slate-100 px-2 py-0.5 text-slate-700">{DIFFICULTY_LABEL[r.difficulty]}</span>
            <span className="rounded-md bg-slate-100 px-2 py-0.5 text-slate-700">
              {Number(r.points)} pt{Number(r.points) === 1 ? "" : "s"}
            </span>
            {r.topic && <span className="rounded-md bg-amber-50 px-2 py-0.5 text-amber-800">{r.topic}</span>}
          </div>
          <p className="line-clamp-3 whitespace-pre-line">{r.stem}</p>
          <p className="text-sm text-slate-600">
            <span className="font-semibold text-slate-800">Answer:</span> {answerPreview(r)}
          </p>
          <div className="flex flex-wrap gap-2 pt-1">
            <Link
              href={`/instructor/courses/${courseId}/items/${r.id}`}
              className="rounded-lg border border-slate-300 px-3 py-2 text-sm font-semibold"
            >
              Edit
            </Link>
            <DuplicateItemButton itemId={r.id} courseId={courseId} />
            <form action={setItemArchived}>
              <input type="hidden" name="item_id" value={r.id} />
              <input type="hidden" name="course_id" value={courseId} />
              <input type="hidden" name="archived" value={String(!r.archived)} />
              <button className="rounded-lg px-3 py-2 text-sm font-medium text-slate-600">
                {r.archived ? "Restore" : "Archive"}
              </button>
            </form>
          </div>
        </Card>
      ))}
    </AppShell>
  );
}
