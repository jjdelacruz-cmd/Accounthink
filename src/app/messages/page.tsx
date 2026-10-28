import { AppShell } from "@/components/AppShell";
import { PageTitle } from "@/components/ui";
import { InboxView } from "@/components/InboxView";
import { requireRole } from "@/lib/auth";
import type { Contact, InboxRow } from "@/lib/messages";
import { createClient } from "@/lib/supabase/server";

export default async function MessagesPage() {
  const profile = await requireRole("student", "instructor", "admin");
  const supabase = await createClient();
  const [{ data: inbox }, { data: contacts }] = await Promise.all([supabase.rpc("my_inbox"), supabase.rpc("my_contacts")]);
  return (
    <AppShell profile={profile}>
      <div>
        <PageTitle>Messages</PageTitle>
        <p className="text-sm text-ink-600">
          {profile.role === "student"
            ? "You can message your instructors. Students can't message each other."
            : "Message your students. They can reply to you here."}
        </p>
      </div>
      <InboxView inbox={(inbox ?? []) as InboxRow[]} contacts={(contacts ?? []) as Contact[]} />
    </AppShell>
  );
}
