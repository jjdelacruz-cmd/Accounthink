"use server";

import { revalidatePath } from "next/cache";
import { requireRole } from "@/lib/auth";
import { validateItem, type ItemDraft } from "@/lib/items";
import { createClient } from "@/lib/supabase/server";

const itemsPath = (courseId: string) => `/instructor/courses/${courseId}/items`;

export async function saveItem(draft: ItemDraft): Promise<{ error?: string; id?: string }> {
  await requireRole("instructor", "admin");
  const result = validateItem(draft);
  if ("error" in result) return { error: result.error };
  const { answer, ...item } = result.item;

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("save_item", { p_item: item, p_answer: answer });
  if (error) return { error: error.message };

  revalidatePath(itemsPath(draft.course_id));
  return { id: data as string };
}

/** Bulk import. Every item is re-validated here; the database saves all or nothing. */
export async function importItems(
  courseId: string,
  drafts: ItemDraft[],
): Promise<{ error?: string; count?: number }> {
  await requireRole("instructor", "admin");
  if (drafts.length === 0) return { error: "Nothing to import." };
  if (drafts.length > 500) return { error: "Import at most 500 items at a time." };

  const items = [];
  for (let i = 0; i < drafts.length; i++) {
    const result = validateItem({ ...drafts[i], id: undefined, course_id: courseId });
    if ("error" in result) return { error: `Item ${i + 1}: ${result.error}` };
    const { type, stem, choices, topic, difficulty, points, explanation, answer } = result.item;
    items.push({ type, stem, choices, topic, difficulty, points, explanation, answer });
  }

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("save_items", { p_course_id: courseId, p_items: items });
  if (error) return { error: error.message };

  revalidatePath(itemsPath(courseId));
  return { count: data as number };
}

export async function setItemArchived(formData: FormData) {
  await requireRole("instructor", "admin");
  const id = String(formData.get("item_id"));
  const courseId = String(formData.get("course_id"));
  const archived = formData.get("archived") === "true";

  const supabase = await createClient();
  await supabase.from("items").update({ archived }).eq("id", id);
  revalidatePath(itemsPath(courseId));
}

export async function duplicateItem(itemId: string): Promise<{ error?: string; id?: string }> {
  await requireRole("instructor", "admin");
  const supabase = await createClient();
  const { data: item, error } = await supabase
    .from("items")
    .select("course_id, type, stem, choices, topic, difficulty, points, explanation, item_keys(answer)")
    .eq("id", itemId)
    .single();
  if (error || !item) return { error: error?.message ?? "Item not found." };

  const { item_keys, ...rest } = item as typeof item & { item_keys: { answer: unknown } | null };
  const { data, error: saveError } = await supabase.rpc("save_item", {
    p_item: { ...rest, stem: `${rest.stem} (copy)` },
    p_answer: item_keys?.answer,
  });
  if (saveError) return { error: saveError.message };

  revalidatePath(itemsPath(rest.course_id));
  return { id: data as string };
}
