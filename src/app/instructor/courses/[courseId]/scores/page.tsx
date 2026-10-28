import Link from "next/link";
import { AppShell } from "@/components/AppShell";
import { CourseNav } from "@/components/CourseNav";
import { DownloadGradebook } from "@/components/DownloadGradebook";
import { GradebookTable } from "@/components/GradebookTable";
import { EmptyState, Notice } from "@/components/ui";
import { getOwnedCourse } from "@/lib/courses";
import type { Gradebook } from "@/lib/gradebook";

export default async function ScoresPage({
  params,
  searchParams,
}: {
  params: Promise<{ courseId: string }>;
  searchParams: Promise<{ section?: string }>;
}) {
  const { courseId } = await params;
  const sp = await searchParams;
  const { profile, supabase, course } = await getOwnedCourse(courseId);
  const { data, error } = await supabase.rpc("course_gradebook", { p_course_id: courseId });
  const book = data as Gradebook | null;
  const section = book?.sections.find((s) => s.id === sp.section);


  return (
    <AppShell profile={profile}>
      <CourseNav course={course} active="scores" />

      {error && <Notice kind="error">{error.message}</Notice>}

      {book && book.exams.length === 0 && (
        <EmptyState icon="chart" title="No scores yet">
          Scores appear here after you publish an exam and students take it.
        </EmptyState>
      )}

      {book && book.exams.length > 0 && (
        <>
          <div className="space-y-2">
            <DownloadGradebook book={book} by={profile.full_name} />
            {section && (
              <DownloadGradebook book={book} sectionId={section.id} sectionName={section.name} by={profile.full_name} secondary />
            )}
            <p className="text-xs text-ink-600">
              One file with a sheet for everyone and one per section, the class average under each, plus an Exams sheet.
              For all your subjects at once, use the button on My courses.
            </p>
          </div>

          {book.sections.length > 1 && (
            <nav className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1" aria-label="Sections">
              <Link href={`/instructor/courses/${courseId}/scores`} className="pill shrink-0" aria-current={!section ? "page" : undefined}>
                All sections
              </Link>
              {book.sections.map((s) => (
                <Link key={s.id} href={`/instructor/courses/${courseId}/scores?section=${s.id}`} className="pill shrink-0" aria-current={section?.id === s.id ? "page" : undefined}>
                  {s.name}
                </Link>
              ))}
            </nav>
          )}

          <GradebookTable book={book} sectionId={section?.id} />

          <p className="text-xs text-ink-600">
            <b>ABS</b> = didn&apos;t take it (counts as 0) · … = started, not submitted · amber = some answers still to be
            checked · Total is over the exams given to that student&apos;s section.
          </p>
        </>
      )}
    </AppShell>
  );
}
