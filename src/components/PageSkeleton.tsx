/** Shown while a page loads (slow mobile data). */
export function PageSkeleton() {
  return (
    <div className="min-h-dvh bg-slate-50" aria-busy="true" aria-label="Loading">
      <div className="h-[61px] border-b border-slate-200 bg-white" />
      <div className="mx-auto max-w-3xl animate-pulse space-y-4 px-4 py-4">
        <div className="h-6 w-1/2 rounded bg-slate-200" />
        <div className="h-28 rounded-2xl bg-slate-200" />
        <div className="h-28 rounded-2xl bg-slate-200" />
        <div className="h-28 rounded-2xl bg-slate-200" />
      </div>
    </div>
  );
}
