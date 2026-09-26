"use server";

import { revalidatePath } from "next/cache";
import { requireRole } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import type { FormState } from "./auth";

export async function joinSection(_: FormState, formData: FormData): Promise<FormState> {
  await requireRole("student");
  const code = String(formData.get("code") ?? "").trim();
  if (!code) return { error: "Enter the join code from your instructor." };

  const supabase = await createClient();
  const { error } = await supabase.rpc("join_section", { p_code: code });
  if (error) return { error: error.message };

  revalidatePath("/student");
  return { message: "You joined the section." };
}
