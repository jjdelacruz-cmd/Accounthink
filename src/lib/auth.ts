import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

export type Role = "student" | "instructor" | "admin";

export type Profile = {
  id: string;
  full_name: string;
  student_no: string | null;
  role: Role;
};

export const HOME_FOR_ROLE: Record<Role, string> = {
  student: "/student",
  instructor: "/instructor",
  admin: "/admin",
};

/** Signed-in user's profile, or null. */
export async function getProfile(): Promise<Profile | null> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  const { data } = await supabase
    .from("profiles")
    .select("id, full_name, student_no, role")
    .eq("id", user.id)
    .single();
  return (data as Profile | null) ?? null;
}

/** Use at the top of a role's layout/page/action. Redirects anyone else away. */
export async function requireRole(...roles: Role[]): Promise<Profile> {
  const profile = await getProfile();
  if (!profile) redirect("/login");
  if (!roles.includes(profile.role)) redirect(HOME_FOR_ROLE[profile.role]);
  return profile;
}
