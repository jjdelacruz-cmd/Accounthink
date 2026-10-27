import Link from "next/link";
import type { ReactNode } from "react";
import { Avatar } from "@/components/Avatar";
import { HOME_FOR_ROLE, type Profile } from "@/lib/auth";
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
  // Big, equal touch targets: icon on phones, icon + label from the "sm" width up.
  const btn =
    "relative flex h-11 min-w-11 flex-col items-center justify-center rounded-xl px-1.5 text-slate-600 hover:bg-slate-100 active:bg-slate-200 sm:min-w-0 sm:flex-row sm:gap-1.5 sm:px-3";
  const label = (icon: string, text: string) => (
    <>
      <span aria-hidden className="text-lg leading-none">
        {icon}
      </span>
      <span className="text-[10px] font-medium leading-tight sm:text-sm">{text}</span>
    </>
  );

  return (
    <div className="min-h-dvh bg-slate-50">
      <header className="sticky top-0 z-10 border-b border-slate-200 bg-white/95 backdrop-blur">
        <div className="mx-auto flex max-w-3xl items-center gap-2 px-3 py-1.5 sm:px-4">
          <div className="flex min-w-0 flex-1 items-center gap-2.5">
            <Avatar name={profile.full_name} src={profile.avatar} size={40} />
            {/* The name needs room; on a small phone the avatar and the buttons come first. */}
            <span className="hidden min-w-0 sm:block">
              <span className="block truncate text-[10px] font-semibold uppercase tracking-wide text-emerald-700 sm:text-xs">
                Accounthink · {ROLE_LABEL[profile.role]}
              </span>
              <span className="block truncate text-sm font-semibold text-slate-900 sm:text-base">
                {profile.full_name || "Unnamed user"}
              </span>
            </span>
          </div>
          <nav className="flex shrink-0 items-center" aria-label="Main">
            <Link href={HOME_FOR_ROLE[profile.role]} className={btn} aria-label="Home" title="Home">
              {label("🏠", "Home")}
            </Link>
            {canMessage && (
              <Link href="/messages" className={btn}>
                {label("✉️", "Messages")}
                {unread > 0 && (
                  <span
                    aria-label={`${unread} unread`}
                    className="absolute right-0 top-0 flex h-5 min-w-5 items-center justify-center rounded-full bg-red-600 px-1 text-[11px] font-bold text-white"
                  >
                    {unread > 99 ? "99+" : unread}
                  </span>
                )}
              </Link>
            )}
            <Link href="/account" className={btn}>
              {label("👤", "Account")}
            </Link>
            <form action="/auth/signout" method="post">
              <button className={btn}>
                {label("🚪", "Sign out")}
              </button>
            </form>
          </nav>
        </div>
      </header>
      <main className="mx-auto max-w-3xl space-y-4 px-4 py-4">{children}</main>
    </div>
  );
}
