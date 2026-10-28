import Link from "next/link";
import type { ReactNode } from "react";
import { Avatar } from "@/components/Avatar";
import { Icon, LogoMark, type IconName } from "@/components/icons";
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
    "relative flex h-12 min-w-12 flex-col items-center justify-center gap-0.5 rounded-control px-1.5 text-white/90 hover:bg-white/10 hover:text-white active:bg-white/20 sm:h-11 sm:min-w-0 sm:flex-row sm:gap-1.5 sm:px-3";
  const label = (icon: IconName, text: string) => (
    <>
      <Icon name={icon} size={22} className="sm:size-5" />
      <span className="text-[11px] font-medium leading-none sm:text-sm">{text}</span>
    </>
  );

  return (
    <div className="min-h-dvh bg-ink-50">
      <header className="sticky top-0 z-10 bg-brand-800 text-white shadow-raised">
        <div className="mx-auto flex max-w-3xl items-center gap-2 px-3 py-1.5 sm:px-4">
          <LogoMark size={32} className="hidden min-[360px]:block" />
          <div className="flex min-w-0 flex-1 items-center gap-2.5">
            <Avatar name={profile.full_name} src={profile.avatar} size={40} className="ring-2 ring-white/60" />
            {/* The name needs room; on a small phone the avatar and the buttons come first. */}
            <span className="hidden min-w-0 sm:block">
              <span className="block truncate text-xs font-semibold uppercase tracking-wide text-brand-100">
                Accounthink · {ROLE_LABEL[profile.role]}
              </span>
              <span className="block truncate text-base font-semibold text-white">
                {profile.full_name || "Unnamed user"}
              </span>
            </span>
          </div>
          <nav className="flex shrink-0 items-center" aria-label="Main">
            <Link href={HOME_FOR_ROLE[profile.role]} className={btn} aria-label="Home" title="Home">
              {label("home", "Home")}
            </Link>
            {canMessage && (
              <Link href="/messages" className={btn}>
                {label("mail", "Messages")}
                {unread > 0 && (
                  <span
                    aria-label={`${unread} unread`}
                    className="absolute right-0 top-0 flex h-5 min-w-5 items-center justify-center rounded-full bg-danger-600 px-1 text-[11px] font-bold text-white ring-2 ring-brand-800"
                  >
                    {unread > 99 ? "99+" : unread}
                  </span>
                )}
              </Link>
            )}
            <Link href="/account" className={btn}>
              {label("user", "Account")}
            </Link>
            <form action="/auth/signout" method="post">
              <button className={btn}>{label("logout", "Sign out")}</button>
            </form>
          </nav>
        </div>
      </header>
      <main className="mx-auto max-w-3xl space-y-5 px-4 py-5 pb-10">{children}</main>
    </div>
  );
}
