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
