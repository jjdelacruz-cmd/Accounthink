import Link from "next/link";
import { setUserRole } from "@/app/actions/admin";
import { AppShell } from "@/components/AppShell";
import { Card } from "@/components/ui";
import { requireRole, type Profile } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";

const ROLES = ["student", "instructor", "admin"] as const;

export default async function AdminHome() {
  const me = await requireRole("admin");
  const supabase = await createClient();
  const { data } = await supabase
    .from("profiles")
    .select("id, full_name, email, student_no, role")
    .order("role")
    .order("full_name");
  const users = (data ?? []) as (Profile & { email: string | null })[];

  return (
    <AppShell profile={me}>
      <Link
        href="/instructor"
        className="block rounded-xl bg-emerald-700 px-4 py-3 text-center font-semibold text-white"
      >
        My courses &amp; exams →
      </Link>
      <h1 className="text-xl font-bold">Users</h1>
      <p className="text-sm text-slate-600">
        Everyone signs up as a student. Promote instructors here.
      </p>
      <Card className="p-0">
        <ul className="divide-y divide-slate-100">
          {users.map((u) => (
            <li key={u.id} className="flex flex-wrap items-center justify-between gap-2 p-3">
              <div className="min-w-0">
                <p className="truncate font-semibold">{u.full_name || "—"}</p>
                <p className="truncate text-xs text-slate-500">
                  {u.email}
                  {u.student_no ? ` · ${u.student_no}` : ""}
                </p>
              </div>
              {u.id === me.id ? (
                <span className="text-xs font-semibold text-slate-500">You (admin)</span>
              ) : (
                <form action={setUserRole} className="flex items-center gap-2">
                  <input type="hidden" name="user_id" value={u.id} />
                  <select
                    name="role"
                    defaultValue={u.role}
                    className="rounded-lg border border-slate-300 bg-white px-2 py-2 text-sm"
                  >
                    {ROLES.map((r) => (
                      <option key={r} value={r}>
                        {r}
                      </option>
                    ))}
                  </select>
                  <button className="rounded-lg bg-emerald-700 px-3 py-2 text-sm font-semibold text-white">
                    Save
                  </button>
                </form>
              )}
            </li>
          ))}
        </ul>
      </Card>
    </AppShell>
  );
}
