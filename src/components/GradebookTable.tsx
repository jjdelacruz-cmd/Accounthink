import { cellFor, examStats, examsFor, studentsOf, totalsFor, type Gradebook } from "@/lib/gradebook";

/** On-screen preview of the Excel sheet: students down, exams across, scrolls sideways on a phone. */
export function GradebookTable({ book, sectionId }: { book: Gradebook; sectionId?: string }) {
  const students = studentsOf(book, sectionId);
  const exams = examsFor(book, students);
  const showSection = !sectionId && book.sections.length > 1;
  const th = "whitespace-nowrap border-b border-slate-200 bg-slate-50 px-2 py-2 text-xs font-semibold text-slate-600";
  const td = "whitespace-nowrap border-b border-slate-100 px-2 py-2";

  if (students.length === 0) return <p className="text-sm text-slate-600">No students in this section yet.</p>;
  return (
    <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
      <table className="min-w-full text-sm">
        <thead>
          <tr>
            <th className={`${th} sticky left-0 z-10 text-left`}>Name</th>
            {showSection && <th className={`${th} text-left`}>Section</th>}
            {exams.map((e) => (
              <th key={e.id} className={`${th} max-w-[9rem] text-center`} title={e.title}>
                <span className="block truncate">{e.title}</span>
                <span className="block font-normal text-slate-500">/{e.max}</span>
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
                  {s.student_no && <span className="block text-xs font-normal text-slate-500">{s.student_no}</span>}
                </td>
                {showSection && <td className={`${td} text-slate-600`}>{s.section_name}</td>}
                {exams.map((e) => {
                  const c = cellFor(s, e);
                  return (
                    <td
                      key={e.id}
                      className={`${td} text-center ${c.kind === "done" && c.pending > 0 ? "bg-amber-100" : ""}`}
                      title={c.kind === "done" && c.pending > 0 ? "Some answers are still waiting to be checked" : undefined}
                    >
                      {c.kind === "done" && c.score}
                      {c.kind === "absent" && <span className="text-xs font-semibold text-red-700">ABS</span>}
                      {c.kind === "progress" && <span className="text-xs italic text-slate-500">…</span>}
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
          <tr className="bg-slate-50 text-xs text-slate-600">
            <td className="sticky left-0 z-10 bg-slate-50 px-2 py-2 font-semibold" colSpan={showSection ? 2 : 1}>
              Average (of those who took it)
            </td>
            {exams.map((e) => {
              const st = examStats(students, e);
              return (
                <td key={e.id} className="px-2 py-2 text-center">
                  {st.average ?? "—"}
                  <span className="block text-[10px] text-slate-400">
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
