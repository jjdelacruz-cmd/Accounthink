import { EmptyState } from "@/components/ui";
import { cellFor, examStats, examsFor, studentsOf, totalsFor, type Gradebook } from "@/lib/gradebook";

/** On-screen preview of the Excel sheet: students down, exams across, scrolls sideways on a phone. */
export function GradebookTable({ book, sectionId }: { book: Gradebook; sectionId?: string }) {
  const students = studentsOf(book, sectionId);
  const exams = examsFor(book, students);
  const showSection = !sectionId && book.sections.length > 1;
  const th = "whitespace-nowrap border-b border-ink-200 bg-ink-100 px-2.5 py-2.5 text-xs font-bold text-ink-700";
  const td = "whitespace-nowrap border-b border-ink-100 px-2.5 py-2.5 tabular-nums";

  if (students.length === 0)
    return (
      <EmptyState icon="users" title="No students yet">
        No students in this section yet.
      </EmptyState>
    );
  return (
    <div className="table-wrap">
      <table className="min-w-full text-sm">
        <thead>
          <tr>
            <th className={`${th} sticky left-0 z-10 text-left`}>Name</th>
            {showSection && <th className={`${th} text-left`}>Section</th>}
            {exams.map((e) => (
              <th key={e.id} className={`${th} max-w-[9rem] text-center`} title={e.title}>
                <span className="block truncate">{e.title}</span>
                <span className="block font-normal text-ink-600">/{e.max}</span>
              </th>
            ))}
            <th className={`${th} text-center`}>Total</th>
            <th className={`${th} text-center`}>%</th>
          </tr>
        </thead>
        <tbody>
          {students.map((s) => {
            const t = totalsFor(s, exams);
            return (
              <tr key={`${s.section_id}-${s.student_id}`}>
                <td className={`${td} sticky left-0 z-10 bg-white font-medium`}>
                  {s.full_name || "—"}
                  {s.student_no && <span className="block text-xs font-normal text-ink-600">{s.student_no}</span>}
                </td>
                {showSection && <td className={`${td} text-ink-600`}>{s.section_name}</td>}
                {exams.map((e) => {
                  const c = cellFor(s, e);
                  return (
                    <td
                      key={e.id}
                      className={`${td} text-center ${c.kind === "done" && c.pending > 0 ? "bg-warning-100" : ""}`}
                      title={c.kind === "done" && c.pending > 0 ? "Some answers are still waiting to be checked" : undefined}
                    >
                      {c.kind === "done" && c.score}
                      {c.kind === "absent" && <span className="text-xs font-semibold text-danger-700">ABS</span>}
                      {c.kind === "progress" && <span className="text-xs italic text-ink-600">…</span>}
                    </td>
                  );
                })}
                <td className={`${td} text-center font-semibold`}>
                  {t.assigned ? `${t.earned}/${t.possible}` : ""}
                </td>
                <td className={`${td} text-center font-semibold`}>{t.percent ?? ""}</td>
              </tr>
            );
          })}
        </tbody>
        <tfoot>
          <tr className="bg-ink-50 text-xs text-ink-700">
            <td className="sticky left-0 z-10 bg-ink-50 px-2.5 py-2.5 font-semibold" colSpan={showSection ? 2 : 1}>
              Average (of those who took it)
            </td>
            {exams.map((e) => {
              const st = examStats(students, e);
              return (
                <td key={e.id} className="px-2.5 py-2.5 text-center tabular-nums">
                  {st.average ?? "—"}
                  <span className="block text-[11px] font-normal text-ink-600">
                    {st.took}/{st.assigned} took it
                  </span>
                </td>
              );
            })}
            <td colSpan={2} />
          </tr>
        </tfoot>
      </table>
    </div>
  );
}
