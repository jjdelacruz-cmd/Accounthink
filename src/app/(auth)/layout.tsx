import type { ReactNode } from "react";

export default function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <main className="flex min-h-dvh items-center justify-center bg-slate-50 px-4 py-8">
      <div className="w-full max-w-sm">
        <div className="mb-6 text-center">
          <p className="text-xs font-semibold uppercase tracking-wide text-emerald-700">
            Our Lady of Fatima University · CBA
          </p>
          <h1 className="mt-1 text-2xl font-bold text-slate-900">Online Exams</h1>
        </div>
        <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">{children}</div>
      </div>
    </main>
  );
}
