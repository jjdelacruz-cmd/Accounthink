"use client";

import { useRouter } from "next/navigation";
import { useMemo, useState, useTransition } from "react";
import { importItems } from "@/app/actions/items";
import { Button, Notice } from "@/components/ui";
import {
  markDuplicates,
  parseDelimited,
  parseRows,
  parseText,
  TEMPLATE_HEADERS,
  TEMPLATE_ROWS,
  toCsv,
  type ParsedItem,
} from "@/lib/import";
import {
  DIFFICULTY_LABEL,
  ITEM_TYPE_LABEL,
  type Difficulty,
  type EnumerationAnswer,
  type IdentificationAnswer,
  type ItemDraft,
  type McqAnswer,
} from "@/lib/items";

const MAX = 500;

const TEXT_EXAMPLE = `1. Which of the following is an asset?
A. Revenue
B. Cash
C. Expense
D. Dividends
ANSWER: B
TOPIC: Basics

2. The assumption that the entity will continue operating for the foreseeable future.
ANSWER: Going concern / Going concern assumption

3. Give three current assets.
ANSWER: Cash; Receivables / Accounts receivable; Inventory
DIFFICULTY: Difficult`;

const input =
  "block w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-base outline-none focus:border-emerald-600 focus:ring-2 focus:ring-emerald-600/20";

function answerSummary(d: ItemDraft): string {
  if (d.type === "mcq") {
    const key = (d.answer as McqAnswer).correct;
    return `${key}. ${d.choices?.find((c) => c.key === key)?.text ?? ""}`;
  }
  if (d.type === "identification") return (d.answer as IdentificationAnswer).accepted.join(" / ");
  const a = d.answer as EnumerationAnswer;
  return `${a.answers.map((alts) => alts.join(" / ")).join("; ")}${a.any_order ? "" : " (in order)"}`;
}

export function ItemImporter({
  courseId,
  courseCode,
  existingStems,
  topics,
}: {
  courseId: string;
  courseCode: string;
  existingStems: string[];
  topics: string[];
}) {
  const router = useRouter();
  const [mode, setMode] = useState<"text" | "sheet">("text");
  const [text, setText] = useState("");
  const [sheetText, setSheetText] = useState("");
  const [fileRows, setFileRows] = useState<string[][] | null>(null);
  const [fileName, setFileName] = useState<string>();
  const [fileError, setFileError] = useState<string>();
  const [topic, setTopic] = useState("");
  const [difficulty, setDifficulty] = useState<Difficulty>("average");
  const [includeDuplicates, setIncludeDuplicates] = useState(false);
  const [showExample, setShowExample] = useState(false);
  const [error, setError] = useState<string>();
  const [pending, start] = useTransition();

  const parsed: ParsedItem[] = useMemo(() => {
    const defaults = { topic: topic.trim(), difficulty };
    let items: ParsedItem[] = [];
    if (mode === "text") items = parseText(text, courseId, defaults);
    else if (fileRows) items = parseRows(fileRows, courseId, defaults);
    else if (sheetText.trim()) items = parseRows(parseDelimited(sheetText), courseId, defaults);
    return markDuplicates(items, existingStems);
  }, [mode, text, sheetText, fileRows, topic, difficulty, courseId, existingStems]);

  const problems = parsed.filter((p) => p.error);
  const duplicates = parsed.filter((p) => p.draft && p.duplicate);
  const toImport = parsed.filter((p) => p.draft && (includeDuplicates || !p.duplicate));

  async function onFile(file: File | undefined) {
    setFileError(undefined);
    setFileRows(null);
    setFileName(file?.name);
    if (!file) return;
    try {
      if (/\.xlsx$/i.test(file.name)) {
        const { readSheet } = await import("read-excel-file/universal");
        const rows = await readSheet(file);
        setFileRows(rows.map((r) => r.map((c) => (c === null || c === undefined ? "" : String(c)))));
      } else if (/\.(csv|tsv|txt)$/i.test(file.name)) {
        setFileRows(parseDelimited(await file.text()));
      } else if (/\.xls$/i.test(file.name)) {
        setFileError("Old .xls files aren't supported. In Excel, use File → Save As → Excel Workbook (.xlsx).");
      } else {
        setFileError("Choose an .xlsx or .csv file.");
      }
    } catch {
      setFileError("Couldn't read that file. Is it a normal Excel (.xlsx) or CSV file?");
    }
  }

  function downloadTemplate() {
    // BOM so Excel opens UTF-8 (ñ, “quotes”) correctly.
    const blob = new Blob(["﻿" + toCsv([TEMPLATE_HEADERS, ...TEMPLATE_ROWS])], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${courseCode}-question-template.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  function doImport() {
    setError(undefined);
    const drafts = toImport.slice(0, MAX).map((p) => p.draft!);
    start(async () => {
      const res = await importItems(courseId, drafts);
      if (res.error) setError(res.error);
      else router.push(`/instructor/courses/${courseId}/items?imported=${res.count}`);
    });
  }

  const tab = (key: "text" | "sheet", label: string) => (
    <button
      type="button"
      onClick={() => setMode(key)}
      className={`flex-1 rounded-lg px-3 py-2 text-sm font-semibold ${
        mode === key ? "bg-white text-emerald-800 shadow-sm" : "text-slate-600"
      }`}
    >
      {label}
    </button>
  );

  return (
    <div className="space-y-4">
      <nav className="flex gap-1 rounded-xl bg-slate-200/70 p-1">
        {tab("text", "Paste from Word")}
        {tab("sheet", "Excel / CSV")}
      </nav>

      <div className="space-y-3 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
        {mode === "text" ? (
          <>
            <p className="text-sm text-slate-600">
              Paste numbered questions. Put <b>ANSWER:</b> after each one, or paste a separate{" "}
              <b>ANSWER KEY</b> list at the end.
            </p>
            <button
              type="button"
              onClick={() => setShowExample(!showExample)}
              className="text-sm font-semibold text-emerald-700"
            >
              {showExample ? "Hide format" : "Show format and rules"}
            </button>
            {showExample && (
              <div className="space-y-2 rounded-xl bg-slate-50 p-3 text-sm">
                <pre className="overflow-x-auto whitespace-pre-wrap font-mono text-xs">{TEXT_EXAMPLE}</pre>
                <ul className="list-disc space-y-1 pl-5 text-slate-700">
                  <li>Choices (A–F) make it <b>multiple choice</b>. Answer with the letter, or put * before the correct choice.</li>
                  <li>No choices and one answer = <b>identification</b>. Separate accepted wordings with “/”.</li>
                  <li>Answers separated by “;” = <b>enumeration</b> (1 point each). Start with “IN ORDER:” if order matters.</li>
                  <li>Optional lines: TOPIC:, DIFFICULTY: (Easy / Average / Difficult), POINTS:.</li>
                  <li>
                    Answer key at the end works too: a line <b>ANSWER KEY</b> then “1. B  2. C  3. Going concern”.
                  </li>
                </ul>
                <button
                  type="button"
                  onClick={() => setText(TEXT_EXAMPLE)}
                  className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 font-semibold"
                >
                  Try the example
                </button>
              </div>
            )}
            <textarea
              value={text}
              onChange={(e) => setText(e.target.value)}
              rows={12}
              placeholder={"1. Your first question?\nA. …\nB. …\nANSWER: B"}
              className={`${input} font-mono text-sm`}
            />
          </>
        ) : (
          <>
            <p className="text-sm text-slate-600">
              One question per row. Columns: <b>Type, Question, A–E, Answer, Topic, Difficulty, Points</b>. Type can
              be left blank and is worked out from the row.
            </p>
            <button
              type="button"
              onClick={downloadTemplate}
              className="rounded-lg border border-slate-300 px-3 py-2 text-sm font-semibold"
            >
              ⬇ Download template (opens in Excel)
            </button>
            <label className="block">
              <span className="mb-1 block text-sm font-medium text-slate-700">Upload .xlsx or .csv</span>
              <input
                type="file"
                accept=".xlsx,.csv,.tsv,.txt"
                onChange={(e) => onFile(e.target.files?.[0])}
                className="block w-full text-sm file:mr-3 file:rounded-lg file:border-0 file:bg-emerald-700 file:px-3 file:py-2 file:font-semibold file:text-white"
              />
            </label>
            {fileName && fileRows && (
              <p className="text-sm text-slate-600">
                {fileName}: {fileRows.length} rows read (first sheet).{" "}
                <button type="button" onClick={() => onFile(undefined)} className="font-semibold underline">
                  Clear
                </button>
              </p>
            )}
            {fileError && <Notice kind="error">{fileError}</Notice>}
            {!fileRows && (
              <label className="block">
                <span className="mb-1 block text-sm font-medium text-slate-700">
                  …or copy the cells in Excel / Google Sheets and paste here
                </span>
                <textarea
                  value={sheetText}
                  onChange={(e) => setSheetText(e.target.value)}
                  rows={6}
                  className={`${input} font-mono text-xs`}
                />
              </label>
            )}
          </>
        )}

        <div className="grid grid-cols-2 gap-3 border-t border-slate-100 pt-3">
          <label className="block">
            <span className="mb-1 block text-xs font-medium text-slate-600">Topic if not given</span>
            <input value={topic} onChange={(e) => setTopic(e.target.value)} list="import-topics" className={input} />
            <datalist id="import-topics">
              {topics.map((t) => (
                <option key={t} value={t} />
              ))}
            </datalist>
          </label>
          <label className="block">
            <span className="mb-1 block text-xs font-medium text-slate-600">Difficulty if not given</span>
            <select
              value={difficulty}
              onChange={(e) => setDifficulty(e.target.value as Difficulty)}
              className={input}
            >
              {(Object.keys(DIFFICULTY_LABEL) as Difficulty[]).map((d) => (
                <option key={d} value={d}>
                  {DIFFICULTY_LABEL[d]}
                </option>
              ))}
            </select>
          </label>
        </div>
      </div>

      {parsed.length > 0 && (
        <div className="space-y-3">
          <div className="flex flex-wrap gap-2 text-sm font-semibold">
            <span className="rounded-full bg-emerald-100 px-3 py-1 text-emerald-800">
              {parsed.length - problems.length} ready
            </span>
            {problems.length > 0 && (
              <span className="rounded-full bg-red-100 px-3 py-1 text-red-800">{problems.length} with problems</span>
            )}
            {duplicates.length > 0 && (
              <span className="rounded-full bg-amber-100 px-3 py-1 text-amber-900">
                {duplicates.length} already in bank
              </span>
            )}
          </div>

          {duplicates.length > 0 && (
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={includeDuplicates}
                onChange={(e) => setIncludeDuplicates(e.target.checked)}
                className="h-5 w-5 accent-emerald-700"
              />
              Import duplicates anyway
            </label>
          )}

          <ul className="space-y-2">
            {problems.map((p, i) => (
              <li key={`p${i}`} className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm">
                <b>{p.source}:</b> {p.error}
              </li>
            ))}
            {parsed
              .filter((p) => p.draft)
              .map((p, i) => (
                <li
                  key={`d${i}`}
                  className={`rounded-xl border bg-white p-3 text-sm ${
                    p.duplicate && !includeDuplicates ? "border-amber-200 opacity-60" : "border-slate-200"
                  }`}
                >
                  <div className="mb-1 flex flex-wrap gap-1 text-xs font-semibold">
                    <span className="text-slate-500">{p.source}</span>
                    <span className="rounded-md bg-emerald-50 px-1.5 text-emerald-800">
                      {ITEM_TYPE_LABEL[p.draft!.type]}
                    </span>
                    <span className="rounded-md bg-slate-100 px-1.5 text-slate-700">
                      {DIFFICULTY_LABEL[p.draft!.difficulty]} · {p.draft!.points} pt
                    </span>
                    {p.draft!.topic && (
                      <span className="rounded-md bg-amber-50 px-1.5 text-amber-800">{p.draft!.topic}</span>
                    )}
                    {p.duplicate && <span className="rounded-md bg-amber-100 px-1.5 text-amber-900">Duplicate</span>}
                  </div>
                  <p className="line-clamp-3 whitespace-pre-line">{p.draft!.stem}</p>
                  {p.draft!.type === "mcq" && (
                    <p className="mt-1 text-xs text-slate-500">
                      {p.draft!.choices!.map((c) => `${c.key}. ${c.text}`).join("  ·  ")}
                    </p>
                  )}
                  <p className="mt-1 text-xs">
                    <span className="font-semibold">Answer:</span> {answerSummary(p.draft!)}
                  </p>
                </li>
              ))}
          </ul>

          {toImport.length > MAX && (
            <Notice kind="error">
              Only the first {MAX} are imported at a time. Import again for the rest.
            </Notice>
          )}
          {error && <Notice kind="error">{error}</Notice>}
          <Button
            type="button"
            disabled={pending || toImport.length === 0}
            onClick={doImport}
            className="sticky bottom-3 w-full shadow-lg"
          >
            {pending
              ? "Importing…"
              : `Import ${Math.min(toImport.length, MAX)} question${toImport.length === 1 ? "" : "s"}`}
          </Button>
          {problems.length > 0 && (
            <p className="text-center text-xs text-slate-500">
              Items with problems are skipped. Fix them in the text above to include them.
            </p>
          )}
        </div>
      )}
    </div>
  );
}
