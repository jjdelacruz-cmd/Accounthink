const STYLE = {
  draft: "bg-slate-100 text-slate-700",
  published: "bg-emerald-100 text-emerald-800",
  closed: "bg-red-50 text-red-700",
} as const;

const LABEL = { draft: "Draft", published: "Published", closed: "Closed" } as const;

export function ExamStatusBadge({ status }: { status: keyof typeof STYLE }) {
  return (
    <span className={`shrink-0 rounded-full px-2.5 py-1 text-xs font-semibold ${STYLE[status]}`}>
      {LABEL[status]}
    </span>
  );
}
