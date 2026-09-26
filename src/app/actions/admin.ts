"use server";

import { revalidatePath } from "next/cache";
import { requireRole, type Role } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";

const ROLES: Role[] = ["student", "instructor", "admin"];

export async function setUserRole(formData: FormData) {
  const me = await requireRole("admin");
  const userId = String(formData.get("user_id") ?? "");
  const role = String(formData.get("role") ?? "") as Role;
  if (!ROLES.includes(role) || userId === me.id) return; // no self-demotion lockout

  const supabase = await createClient();
  await supabase.from("profiles").update({ role }).eq("id", userId);
  revalidatePath("/admin");
}
