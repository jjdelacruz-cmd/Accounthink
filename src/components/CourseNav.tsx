import type { IconName } from "@/components/icons";
import { BackLink, PageTitle, TabLink } from "@/components/ui";

type Key = "items" | "exams" | "scores" | "students" | "announcements";

// Short labels and an icon above each, so all five fit on one row of a small phone.
const TABS: { key: Key; label: string; icon: IconName }[] = [
  { key: "items", label: "Items", icon: "layers" },
  { key: "exams", label: "Exams", icon: "clipboard" },
  { key: "scores", label: "Scores", icon: "chart" },
  { key: "students", label: "Students", icon: "users" },
  { key: "announcements", label: "News", icon: "megaphone" },
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
      <BackLink href="/instructor">My courses</BackLink>
      <PageTitle eyebrow={course.code}>{course.title}</PageTitle>
      <nav className="tabs grid-cols-5" aria-label="Course sections">
        {TABS.map((t) => (
          <TabLink
            key={t.key}
            href={`/instructor/courses/${course.id}/${t.key}`}
            active={active === t.key}
            icon={t.icon}
            className="min-h-14 flex-col gap-0.5 px-0 text-[11px] tracking-tight min-[360px]:text-xs sm:min-h-11 sm:flex-row sm:gap-1.5 sm:text-sm"
          >
            {t.label}
          </TabLink>
        ))}
      </nav>
    </div>
  );
}
