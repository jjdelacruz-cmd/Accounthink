"use server";

import { revalidatePath } from "next/cache";
import { requireRole } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";

/** The student has read their score-change notices. */
export async function dismissScoreUpdates(): Promise<{ error?: string }> {
  await requireRole("student");
  const supabase = await createClient();
  const { error } = await supabase.rpc("dismiss_score_updates");
  if (error) return { error: error.message };
  revalidatePath("/student");
  return {};
}
