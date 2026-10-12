import Link from "next/link";
import type { ReactNode } from "react";
import { Avatar } from "@/components/Avatar";
import type { Profile } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";

const ROLE_LABEL = {
  student: "Student",
  instructor: "Instructor",
  admin: "Instructor · Admin",
  checker: "Checker",
} as const;

export async function AppShell({ profile, children }: { profile: Profile; children: ReactNode }) {
  // Checkers have no messages; everyone else sees a badge for unread ones.
  const canMessage = profile.role !== "checker";
  let unread = 0;
  if (canMessage) {
    const supabase = await createClient();
    const { data } = await supabase.rpc("unread_messages");
    unread = Number(data ?? 0);
  }
  const link = "rounded-lg px-2.5 py-2 text-sm font-medium text-slate-600 hover:bg-slate-100";

  return (
    <div className="min-h-dvh bg-slate-50">
      <header className="sticky top-0 z-10 border-b border-slate-200 bg-white/95 backdrop-blur">
        <div className="mx-auto flex max-w-3xl flex-wrap items-center justify-between gap-x-3 gap-y-1 px-4 py-2">
          <div className="flex min-w-0 flex-1 basis-60 items-center gap-3">
            <Avatar name={profile.full_name} src={profile.avatar} size={40} />
            <div className="min-w-0">
              <p className="truncate text-xs font-semibold uppercase tracking-wide text-emerald-700">
                Accounthink · {ROLE_LABEL[profile.role]}
              </p>
              <p className="truncate font-semibold text-slate-900">{profile.full_name || "Unnamed user"}</p>
            </div>
          </div>
          <div className="ml-auto flex shrink-0 items-center">
            {canMessage && (
              <Link href="/messages" className={`relative ${link}`}>
                Messages
                {unread > 0 && (
                  <span
                    aria-label={`${unread} unread`}
                    className="absolute -right-0.5 -top-0.5 flex h-5 min-w-5 items-center justify-center rounded-full bg-red-600 px-1 text-[11px] font-bold text-white"
                  >
                    {unread > 99 ? "99+" : unread}
                  </span>
                )}
              </Link>
            )}
            <Link href="/account" className={link}>
              Account
            </Link>
            <form action="/auth/signout" method="post">
              <button className={link}>Sign out</button>
            </form>
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-3xl space-y-4 px-4 py-4">{children}</main>
    </div>
  );
}
