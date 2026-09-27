import Link from "next/link";
import type { ReactNode } from "react";
import type { Profile } from "@/lib/auth";

const ROLE_LABEL = { student: "Student", instructor: "Instructor", admin: "Instructor · Admin" } as const;

export function AppShell({ profile, children }: { profile: Profile; children: ReactNode }) {
  return (
    <div className="min-h-dvh bg-slate-50">
      <header className="sticky top-0 z-10 border-b border-slate-200 bg-white/95 backdrop-blur">
        <div className="mx-auto flex max-w-3xl items-center justify-between gap-3 px-4 py-3">
          <div className="min-w-0">
            <p className="text-xs font-semibold uppercase tracking-wide text-emerald-700">
              Accounthink · {ROLE_LABEL[profile.role]}
            </p>
            <p className="truncate font-semibold text-slate-900">
              {profile.full_name || "Unnamed user"}
            </p>
          </div>
          <div className="flex shrink-0 items-center">
            <Link href="/account" className="rounded-lg px-3 py-2 text-sm font-medium text-slate-600 hover:bg-slate-100">
              Account
            </Link>
            <form action="/auth/signout" method="post">
              <button className="rounded-lg px-3 py-2 text-sm font-medium text-slate-600 hover:bg-slate-100">
                Sign out
              </button>
            </form>
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-3xl space-y-4 px-4 py-4">{children}</main>
    </div>
  );
}
