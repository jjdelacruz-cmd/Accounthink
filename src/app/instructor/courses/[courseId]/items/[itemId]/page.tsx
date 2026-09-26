import Link from "next/link";
import { notFound } from "next/navigation";
import { AppShell } from "@/components/AppShell";
import { ItemEditor } from "@/components/ItemEditor";
import { Card } from "@/components/ui";
import { getOwnedCourse } from "@/lib/courses";
import type { Answer, ItemDraft } from "@/lib/items";
import { getTopics } from "../topics";

export default async function EditItemPage({
  params,
}: {
  params: Promise<{ courseId: string; itemId: string }>;
}) {
  const { courseId, itemId } = await params;
  const { profile, supabase, course } = await getOwnedCourse(courseId);

  const { data } = await supabase
    .from("items")
    .select("id, type, stem, choices, topic, difficulty, points, explanation, item_keys(answer)")
    .eq("id", itemId)
    .eq("course_id", courseId)
    .maybeSingle();
  if (!data) notFound();

  const { item_keys, ...row } = data as typeof data & { item_keys: { answer: Answer } | null };
  const initial: ItemDraft = {
    ...row,
    course_id: courseId,
    topic: row.topic ?? "",
    explanation: row.explanation ?? "",
    points: Number(row.points),
    answer: item_keys?.answer ?? { correct: "" },
  };

  const { count } = await supabase
    .from("exam_items")
    .select("exam_id", { count: "exact", head: true })
    .eq("item_id", itemId);
  const topics = await getTopics(supabase, courseId);

  return (
    <AppShell profile={profile}>
      <Link href={`/instructor/courses/${courseId}/items`} className="text-sm font-medium text-emerald-700">
        ← {course.code} item bank
      </Link>
      <h1 className="text-xl font-bold">Edit item</h1>
      {!!count && (
        <p className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
          Used in {count} exam{count === 1 ? "" : "s"}. Changes apply there too.
        </p>
      )}
      <Card>
        <ItemEditor courseId={courseId} initial={initial} topics={topics} />
      </Card>
    </AppShell>
  );
}
