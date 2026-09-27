export const dynamic = "force-static";

export default function OfflinePage() {
  return (
    <main className="flex min-h-dvh flex-col items-center justify-center gap-4 bg-slate-50 px-6 text-center">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src="/icons/icon-192.png" alt="" width={72} height={72} className="rounded-2xl" />
      <h1 className="text-xl font-bold">You&apos;re offline</h1>
      <p className="max-w-xs text-slate-600">
        Accounthink needs the internet. Check your Wi-Fi or mobile data, then try again.
      </p>
      <p className="max-w-xs text-sm text-slate-500">
        If you were taking an exam, your saved answers are safe, but your timer keeps running.
      </p>
      {/* Full reload on purpose: it recovers from errors/offline where client navigation would not. */}
      {/* eslint-disable-next-line @next/next/no-html-link-for-pages */}
      <a href="/" className="min-h-12 rounded-xl bg-emerald-700 px-6 py-3 font-semibold text-white">
        Try again
      </a>
    </main>
  );
}
