import Link from "next/link";
import { AppShell } from "@/components/AppShell";
import { CourseNav } from "@/components/CourseNav";
import { DownloadGradebook } from "@/components/DownloadGradebook";
import { GradebookTable } from "@/components/GradebookTable";
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

  const pill = (active: boolean) =>
    `shrink-0 rounded-full border px-3 py-1.5 text-sm font-semibold ${
      active ? "border-emerald-600 bg-emerald-50 text-emerald-800" : "border-slate-300 bg-white text-slate-700"
    }`;

  return (
    <AppShell profile={profile}>
      <CourseNav course={course} active="scores" />

      {error && <p className="rounded-xl bg-red-50 p-3 text-red-800">{error.message}</p>}

      {book && book.exams.length === 0 && (
        <p className="text-sm text-slate-600">
          No scores yet. Scores appear here after you publish an exam and students take it.
        </p>
      )}

      {book && book.exams.length > 0 && (
        <>
          <div className="space-y-2">
            <DownloadGradebook book={book} by={profile.full_name} />
            {section && (
              <DownloadGradebook book={book} sectionId={section.id} sectionName={section.name} by={profile.full_name} secondary />
            )}
            <p className="text-xs text-slate-500">
              One file with a sheet for everyone and one per section, the class average under each, plus an Exams sheet.
              For all your subjects at once, use the button on My courses.
            </p>
          </div>

          {book.sections.length > 1 && (
            <nav className="flex gap-2 overflow-x-auto pb-1" aria-label="Sections">
              <Link href={`/instructor/courses/${courseId}/scores`} className={pill(!section)}>
                All sections
              </Link>
              {book.sections.map((s) => (
                <Link key={s.id} href={`/instructor/courses/${courseId}/scores?section=${s.id}`} className={pill(section?.id === s.id)}>
                  {s.name}
                </Link>
              ))}
            </nav>
          )}

          <GradebookTable book={book} sectionId={section?.id} />

          <p className="text-xs text-slate-500">
            <b>ABS</b> = didn&apos;t take it (counts as 0) · … = started, not submitted · amber = some answers still to be
            checked · Total is over the exams given to that student&apos;s section.
          </p>
        </>
      )}
    </AppShell>
  );
}
