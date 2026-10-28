"use client";

import { useState, useTransition } from "react";
import { loadAllGradebooks } from "@/app/actions/gradebook";
import { Icon } from "@/components/icons";
import { Button, Notice } from "@/components/ui";
import { downloadXlsx } from "@/lib/downloadXlsx";
import { buildGradebookWorkbook, type Gradebook } from "@/lib/gradebook";
import { safeFileName } from "@/lib/results";

type Props = { className?: string };

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
      <Button
        type="button"
        variant={secondary ? "secondary" : "primary"}
        block
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
      >
        <Icon name="download" size={18} />
        {pending
          ? "Making the file…"
          : sectionName
            ? `Excel: only ${sectionName}`
            : `Excel: ${book.course.code}${book.sections.length > 1 ? ", every section (1 sheet each)" : ""}`}
      </Button>
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
      <Button
        type="button"
        variant="secondary"
        size="sm"
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
        className="w-full sm:w-auto"
      >
        <Icon name="download" size={16} />
        {pending ? "Preparing…" : "Scores of all my subjects (Excel)"}
      </Button>
      {error && <Notice kind="error">{error}</Notice>}
    </div>
  );
}
