import type { SupabaseClient } from "@supabase/supabase-js";

export async function getTopics(supabase: SupabaseClient, courseId: string): Promise<string[]> {
  const { data } = await supabase
    .from("items")
    .select("topic")
    .eq("course_id", courseId)
    .not("topic", "is", null);
  return [...new Set((data ?? []).map((r) => r.topic as string))].sort();
}
