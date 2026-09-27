"use client";

export default function ErrorPage({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <main className="flex min-h-dvh flex-col items-center justify-center gap-4 bg-slate-50 px-6 text-center">
      <h1 className="text-xl font-bold">Something went wrong</h1>
      <p className="max-w-xs text-slate-600">
        Please try again. If you&apos;re in an exam, your saved answers are safe.
      </p>
      <div className="flex gap-2">
        <button onClick={reset} className="min-h-12 rounded-xl bg-emerald-700 px-6 font-semibold text-white">
          Try again
        </button>
        {/* Full reload on purpose: it recovers from errors/offline where client navigation would not. */}
        {/* eslint-disable-next-line @next/next/no-html-link-for-pages */}
        <a href="/" className="flex min-h-12 items-center rounded-xl border border-slate-300 px-6 font-semibold">
          Home
        </a>
      </div>
    </main>
  );
}
