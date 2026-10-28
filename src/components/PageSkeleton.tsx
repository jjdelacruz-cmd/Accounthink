/** Shown while a page loads (slow mobile data). Mirrors the real layout: header bar, title, cards. */
export function PageSkeleton() {
  return (
    <div className="min-h-dvh bg-ink-50" aria-busy="true" aria-label="Loading">
      <div className="h-[61px] bg-brand-800" />
      <div className="mx-auto max-w-3xl animate-pulse space-y-5 px-4 py-5">
        <div className="h-7 w-1/2 rounded-chip bg-ink-200" />
        <div className="h-28 rounded-card bg-ink-200/80" />
        <div className="h-28 rounded-card bg-ink-200/80" />
        <div className="h-28 rounded-card bg-ink-200/80" />
      </div>
    </div>
  );
}
