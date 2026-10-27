import Link from "next/link";

type Key = "items" | "exams" | "scores" | "students" | "announcements";

// Short labels and an icon above each, so all five fit on one row of a small phone.
const TABS: { key: Key; label: string; icon: string }[] = [
  { key: "items", label: "Items", icon: "🗂" },
  { key: "exams", label: "Exams", icon: "📝" },
  { key: "scores", label: "Scores", icon: "📊" },
  { key: "students", label: "Students", icon: "👥" },
  { key: "announcements", label: "News", icon: "📣" },
];

export function CourseNav({
  course,
  active,
}: {
  course: { id: string; code: string; title: string };
  active: Key;
}) {
  return (
    <div className="space-y-3">
      <Link href="/instructor" className="text-sm font-medium text-emerald-700">
        ← My courses
      </Link>
      <div>
        <p className="text-sm font-semibold text-emerald-700">{course.code}</p>
        <h1 className="text-xl font-bold">{course.title}</h1>
      </div>
      <nav className="grid grid-cols-5 gap-1 rounded-xl bg-slate-200/70 p-1" aria-label="Course sections">
        {TABS.map((t) => (
          <Link
            key={t.key}
            href={`/instructor/courses/${course.id}/${t.key}`}
            aria-current={active === t.key ? "page" : undefined}
            className={`flex min-h-14 flex-col items-center justify-center gap-0.5 rounded-lg px-0.5 py-1.5 text-[11px] font-semibold leading-tight sm:min-h-11 sm:flex-row sm:gap-1.5 sm:text-sm ${
              active === t.key ? "bg-white text-emerald-800 shadow-sm" : "text-slate-600 active:bg-white/60"
            }`}
          >
            <span aria-hidden className="text-base leading-none sm:text-sm">
              {t.icon}
            </span>
            <span className="max-w-full truncate">{t.label}</span>
          </Link>
        ))}
      </nav>
    </div>
  );
}
