"use client";

import { useState, useTransition } from "react";
import { loadAllGradebooks } from "@/app/actions/gradebook";
import { Notice } from "@/components/ui";
import { downloadXlsx } from "@/lib/downloadXlsx";
import { buildGradebookWorkbook, type Gradebook } from "@/lib/gradebook";
import { safeFileName } from "@/lib/results";

type Props = { className?: string };

const base =
  "min-h-12 w-full rounded-xl px-4 text-base font-semibold disabled:opacity-50";

/** One subject: all sections (a sheet each), or just one section. */
export function DownloadGradebook({
  book,
  sectionId,
  sectionName,
  by,
  secondary = false,
}: {
  book: Gradebook;
  sectionId?: string;
  sectionName?: string;
  by: string;
  secondary?: boolean;
}) {
  const [pending, start] = useTransition();
  const [error, setError] = useState<string>();
  return (
    <div className="space-y-2">
      <button
        type="button"
        disabled={pending}
        onClick={() =>
          start(async () => {
            setError(undefined);
            try {
              const sheets = buildGradebookWorkbook([book], { sectionId, generatedBy: by });
              await downloadXlsx(sheets, `${safeFileName(`${book.course.code}${sectionName ? ` ${sectionName}` : ""} scores`)}.xlsx`);
            } catch {
              setError("Couldn't make the Excel file. Try again.");
            }
          })
        }
        className={`${base} ${secondary ? "border border-slate-300 bg-white text-slate-800" : "bg-emerald-700 text-white"}`}
      >
        {pending
          ? "Making the file…"
          : sectionName
            ? `⬇ Excel: only ${sectionName}`
            : `⬇ Excel: ${book.course.code}${book.sections.length > 1 ? ", every section (1 sheet each)" : ""}`}
      </button>
      {error && <Notice kind="error">{error}</Notice>}
    </div>
  );
}

/** Every subject of the instructor in one workbook. */
export function DownloadAllGradebooks({ className = "" }: Props) {
  const [pending, start] = useTransition();
  const [error, setError] = useState<string>();
  return (
    <div className={`space-y-2 ${className}`}>
      <button
        type="button"
        disabled={pending}
        onClick={() =>
          start(async () => {
            setError(undefined);
            const res = await loadAllGradebooks();
            if (res.error || !res.books) {
              setError(res.error ?? "Nothing to download.");
              return;
            }
            try {
              await downloadXlsx(buildGradebookWorkbook(res.books, { generatedBy: res.by }), "Accounthink scores - all subjects.xlsx");
            } catch {
              setError("Couldn't make the Excel file. Try again.");
            }
          })
        }
        className="min-h-11 w-full rounded-xl border border-slate-300 bg-white px-3 text-sm font-semibold disabled:opacity-50 sm:w-auto"
      >
        {pending ? "Preparing…" : "⬇ Scores of all my subjects (Excel)"}
      </button>
      {error && <Notice kind="error">{error}</Notice>}
    </div>
  );
}
