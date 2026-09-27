import Link from "next/link";

export default function NotFound() {
  return (
    <main className="flex min-h-dvh flex-col items-center justify-center gap-4 bg-slate-50 px-6 text-center">
      <h1 className="text-xl font-bold">Page not found</h1>
      <p className="max-w-xs text-slate-600">
        This page doesn&apos;t exist, or you don&apos;t have access to it.
      </p>
      <Link href="/" className="min-h-12 rounded-xl bg-emerald-700 px-6 py-3 font-semibold text-white">
        Go home
      </Link>
    </main>
  );
}
