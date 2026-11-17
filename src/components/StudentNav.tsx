import type { IconName } from "@/components/icons";
import { TabLink } from "@/components/ui";

const TABS: { key: "classes" | "scores"; label: string; href: string; icon: IconName }[] = [
  { key: "classes", label: "My classes", href: "/student", icon: "clipboard" },
  { key: "scores", label: "My scores", href: "/student/scores", icon: "chart" },
];

/** Two big tabs under the header of the student's own pages. */
export function StudentNav({ active }: { active: "classes" | "scores" }) {
  return (
    <nav className="tabs grid-cols-2" aria-label="Student sections">
      {TABS.map((t) => (
        <TabLink key={t.key} href={t.href} active={active === t.key} icon={t.icon} className="min-h-12 gap-1.5">
          {t.label}
        </TabLink>
      ))}
    </nav>
  );
}
