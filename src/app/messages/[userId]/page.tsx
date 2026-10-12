import Link from "next/link";
import { notFound } from "next/navigation";
import { AppShell } from "@/components/AppShell";
import { ThreadView } from "@/components/ThreadView";
import { requireRole } from "@/lib/auth";
import type { Thread } from "@/lib/messages";
import { createClient } from "@/lib/supabase/server";

export default async function ThreadPage({ params }: { params: Promise<{ userId: string }> }) {
  const { userId } = await params;
  const profile = await requireRole("student", "instructor", "admin");
  if (!/^[0-9a-f-]{36}$/i.test(userId)) notFound();
  const supabase = await createClient();
  // Opening the conversation marks its messages as read, so it runs before the header counts unread ones.
  const { data, error } = await supabase.rpc("message_thread", { p_other: userId });
  if (error || !data) notFound();
  return (
    <AppShell profile={profile}>
      <Link href="/messages" className="text-sm font-medium text-emerald-700">
        ← All messages
      </Link>
      <ThreadView initial={data as Thread} />
    </AppShell>
  );
}
