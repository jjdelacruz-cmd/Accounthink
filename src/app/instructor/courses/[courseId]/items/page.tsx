import Link from "next/link";
import { AppShell } from "@/components/AppShell";
import { CourseNav } from "@/components/CourseNav";
import { ItemList, type ItemRow } from "@/components/ItemList";
import { UploadsPanel, type BatchRow } from "@/components/UploadsPanel";
import { getOwnedCourse } from "@/lib/courses";
import { DIFFICULTY_LABEL, ITEM_TYPE_LABEL, type Answer } from "@/lib/items";
import { getTopics } from "./topics";

type Raw = Omit<ItemRow, "batch_label" | "answer"> & {
  item_keys: { answer: Answer } | null;
  item_batches: { label: string } | null;
};

export default async function ItemBankPage({
  params,
  searchParams,
}: {
  params: Promise<{ courseId: string }>;
  searchParams: Promise<{
    q?: string;
    type?: string;
    topic?: string;
    difficulty?: string;
    archived?: string;
    batch?: string;
    imported?: string;
  }>;
}) {
  const { courseId } = await params;
  const f = await searchParams;
  const { profile, supabase, course } = await getOwnedCourse(courseId);

  let query = supabase
    .from("items")
    .select("id, type, stem, choices, topic, difficulty, points, archived, item_keys(answer), item_batches(label)")
    .eq("course_id", courseId)
    .eq("archived", f.archived === "1")
    .order("created_at", { ascending: false })
    .limit(300);
  if (f.type) query = query.eq("type", f.type);
  if (f.difficulty) query = query.eq("difficulty", f.difficulty);
  if (f.topic) query = query.eq("topic", f.topic);
  if (f.batch === "none") query = query.is("batch_id", null);
  else if (f.batch) query = query.eq("batch_id", f.batch);
  if (f.q) query = query.ilike("stem", `%${f.q.replace(/[%_]/g, "")}%`);

  const [{ data }, { data: batchData }, { count: individualCount }, topics] = await Promise.all([
    query,
    supabase
      .from("item_batches")
      .select("id, label, source, created_at, items(count)")
      .eq("course_id", courseId)
      .order("created_at", { ascending: false }),
    supabase.from("items").select("id", { count: "exact", head: true }).eq("course_id", courseId).is("batch_id", null),
    getTopics(supabase, courseId),
  ]);

  const items: ItemRow[] = ((data ?? []) as unknown as Raw[]).map(({ item_keys, item_batches, ...r }) => ({
    ...r,
    answer: item_keys?.answer ?? null,
    batch_label: item_batches?.label ?? null,
  }));
  const batches: BatchRow[] = (
    (batchData ?? []) as unknown as (Omit<BatchRow, "count"> & { items: { count: number }[] })[]
  ).map(({ items: c, ...b }) => ({ ...b, count: c[0]?.count ?? 0 }));
  const activeBatch = f.batch === "none" ? "Added individually / earlier imports" : batches.find((b) => b.id === f.batch)?.label;

  const select = "rounded-xl border border-slate-300 bg-white px-2 py-2 text-sm";

  return (
    <AppShell profile={profile}>
      <CourseNav course={course} active="items" />

      {f.imported && (
        <p className="rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
          Imported {f.imported} question{f.imported === "1" ? "" : "s"}
          {activeBatch && f.batch !== "none" ? ` as “${activeBatch}”` : ""}.
        </p>
      )}

      <div className="grid grid-cols-2 gap-2">
        <Link
          href={`/instructor/courses/${courseId}/items/new`}
          className="rounded-xl bg-emerald-700 px-4 py-3 text-center font-semibold text-white"
        >
          + New item
        </Link>
        <Link
          href={`/instructor/courses/${courseId}/items/import`}
          className="rounded-xl border border-slate-300 bg-white px-4 py-3 text-center font-semibold"
        >
          ⬆ Import
        </Link>
      </div>

      <UploadsPanel
        courseId={courseId}
        batches={batches}
        individualCount={individualCount ?? 0}
        activeBatch={f.batch}
      />

      <form className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <input
          name="q"
          defaultValue={f.q}
          placeholder="Search questions"
          className={`${select} col-span-2 sm:col-span-4`}
        />
        <select name="batch" defaultValue={f.batch ?? ""} className={`${select} col-span-2 sm:col-span-4`} aria-label="Upload">
          <option value="">All uploads</option>
          {batches.map((b) => (
            <option key={b.id} value={b.id}>
              ⬆ {b.label} ({b.count})
            </option>
          ))}
          <option value="none">Added individually / earlier imports ({individualCount ?? 0})</option>
        </select>
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
        {activeBatch ? ` in “${activeBatch}”` : ""}
        {items.length === 300 ? " (showing first 300)" : ""}
        {(f.batch || f.q || f.type || f.topic || f.difficulty || f.archived) && (
          <>
            {" · "}
            <Link href={`/instructor/courses/${courseId}/items`} className="font-semibold text-emerald-700">
              Clear filters
            </Link>
          </>
        )}
      </p>

      <ItemList courseId={courseId} items={items} archivedView={f.archived === "1"} />
    </AppShell>
  );
}
