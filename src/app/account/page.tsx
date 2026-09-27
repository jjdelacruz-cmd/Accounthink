import Link from "next/link";
import { redirect } from "next/navigation";
import { changePassword, updateProfile } from "@/app/actions/account";
import { ActionForm } from "@/components/ActionForm";
import { AppShell } from "@/components/AppShell";
import { Card, Field } from "@/components/ui";
import { getProfile, HOME_FOR_ROLE } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";

export default async function AccountPage() {
  const profile = await getProfile();
  if (!profile) redirect("/login");
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  return (
    <AppShell profile={profile}>
      <Link href={HOME_FOR_ROLE[profile.role]} className="text-sm font-medium text-emerald-700">
        ← Back
      </Link>
      <h1 className="text-xl font-bold">Account</h1>
      <p className="text-sm text-slate-600">Signed in as {user?.email}</p>

      <Card>
        <h2 className="mb-3 font-semibold">Your details</h2>
        <ActionForm action={updateProfile} submitLabel="Save" resetOnSuccess={false}>
          <Field label="Full name (Last, First M.I.)" name="full_name" defaultValue={profile.full_name} required />
          {profile.role === "student" && (
            <Field label="Student number" name="student_no" defaultValue={profile.student_no ?? ""} inputMode="numeric" />
          )}
        </ActionForm>
      </Card>

      <Card>
        <h2 className="mb-1 font-semibold">Change password</h2>
        <p className="mb-3 text-sm text-slate-600">If your instructor gave you a temporary password, set your own here.</p>
        <ActionForm action={changePassword} submitLabel="Change password">
          <Field label="New password (min. 8 characters)" name="password" type="password" autoComplete="new-password" minLength={8} required />
          <Field label="Type it again" name="confirm" type="password" autoComplete="new-password" minLength={8} required />
        </ActionForm>
      </Card>
    </AppShell>
  );
}
