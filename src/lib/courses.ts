import { notFound } from "next/navigation";
import { requireRole } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";

/** Loads a course the signed-in instructor owns (RLS hides others) or 404s. */
export async function getOwnedCourse(courseId: string) {
  const profile = await requireRole("instructor", "admin");
  const supabase = await createClient();
  const { data: course } = await supabase
    .from("courses")
    .select("id, code, title")
    .eq("id", courseId)
    .maybeSingle();
  if (!course) notFound();
  return { profile, supabase, course };
}
