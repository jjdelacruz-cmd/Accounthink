"use client";

import { useRouter } from "next/navigation";
import { useMemo, useState, useTransition } from "react";
import { importItems } from "@/app/actions/items";
import { Icon } from "@/components/icons";
import { Badge, Button, Notice, inputClass, labelClass } from "@/components/ui";
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
  type EssayAnswer,
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

const input = inputClass;

function answerSummary(d: ItemDraft): string {
  if (d.type === "mcq") {
    const key = (d.answer as McqAnswer).correct;
    return `${key}. ${d.choices?.find((c) => c.key === key)?.text ?? ""}`;
  }
  if (d.type === "identification") return (d.answer as IdentificationAnswer).accepted.join(" / ");
  if (d.type === "essay") return (d.answer as EssayAnswer).guide ? `Guide: ${(d.answer as EssayAnswer).guide}` : "Checked by hand";
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
  const [label, setLabel] = useState("");
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
    // Suggest the file name as the upload name (without the extension).
    if (file && !label.trim()) setLabel(file.name.replace(/\.[^.]+$/, ""));
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
      const source = mode === "text" ? "word" : "sheet";
      const res = await importItems(courseId, drafts, label, source);
      if (res.error) setError(res.error);
      else router.push(`/instructor/courses/${courseId}/items?batch=${res.batchId}&imported=${res.count}`);
    });
  }

  const tab = (key: "text" | "sheet", label: string) => (
    <button
      type="button"
      onClick={() => setMode(key)}
      aria-pressed={mode === key}
      className="tab"
    >
      {label}
    </button>
  );

  return (
    <div className="space-y-4">
      <nav className="tabs grid-cols-2">
        {tab("text", "Paste from Word")}
        {tab("sheet", "Excel / CSV")}
      </nav>

      <div className="card space-y-4">
        {mode === "text" ? (
          <>
            <p className="text-sm text-ink-600">
              Paste numbered questions. Put <b>ANSWER:</b> after each one, or paste a separate{" "}
              <b>ANSWER KEY</b> list at the end.
            </p>
            <button
              type="button"
              onClick={() => setShowExample(!showExample)}
              className="btn btn-ghost btn-sm -ml-2"
            >
              {showExample ? "Hide format" : "Show format and rules"}
            </button>
            {showExample && (
              <div className="space-y-2 rounded-control bg-ink-50 p-3 text-sm">
                <pre className="overflow-x-auto whitespace-pre-wrap font-mono text-xs">{TEXT_EXAMPLE}</pre>
                <ul className="list-disc space-y-1 pl-5 text-ink-700">
                  <li>Choices (A–F) make it <b>multiple choice</b>. Answer with the letter, or put * before the correct choice.</li>
                  <li>No choices and one answer = <b>identification</b>. Separate accepted wordings with “/”.</li>
                  <li>Answers separated by “;” = <b>enumeration</b> (1 point each). Start with “IN ORDER:” if order matters.</li>
                  <li>
                    <b>Essay</b>: add a line <b>TYPE: Essay</b> (5 points unless you add POINTS:). An ANSWER: line is
                    optional and becomes your guide for checking.
                  </li>
                  <li>Optional lines: TOPIC:, DIFFICULTY: (Easy / Average / Difficult), POINTS:.</li>
                  <li>
                    Answer key at the end works too: a line <b>ANSWER KEY</b> then “1. B  2. C  3. Going concern”.
                  </li>
                </ul>
                <button
                  type="button"
                  onClick={() => setText(TEXT_EXAMPLE)}
                  className="btn btn-secondary btn-sm"
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
            <p className="text-sm text-ink-600">
              One question per row. Columns: <b>Type, Question, A–E, Answer, Topic, Difficulty, Points</b>. Type can
              be left blank and is worked out from the row.
            </p>
            <button
              type="button"
              onClick={downloadTemplate}
              className="btn btn-secondary btn-sm"
            >
              <Icon name="download" size={16} /> Download template (opens in Excel)
            </button>
            <label className="block">
              <span className={labelClass}>Upload .xlsx or .csv</span>
              <input
                type="file"
                accept=".xlsx,.csv,.tsv,.txt"
                onChange={(e) => onFile(e.target.files?.[0])}
                className="block w-full text-sm text-ink-700 file:mr-3 file:min-h-10 file:cursor-pointer file:rounded-chip file:border-0 file:bg-brand-700 file:px-4 file:font-semibold file:text-white hover:file:bg-brand-800"
              />
            </label>
            {fileName && fileRows && (
              <p className="text-sm text-ink-600">
                {fileName}: {fileRows.length} rows read (first sheet).{" "}
                <button type="button" onClick={() => onFile(undefined)} className="font-semibold text-brand-800 underline">
                  Clear
                </button>
              </p>
            )}
            {fileError && <Notice kind="error">{fileError}</Notice>}
            {!fileRows && (
              <label className="block">
                <span className={labelClass}>
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

        <label className="block border-t border-ink-100 pt-3">
          <span className={labelClass}>
            Name this upload (to find or remove it later)
          </span>
          <input
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            maxLength={120}
            placeholder="e.g. Chapter 3 quiz – Audit evidence"
            className={input}
          />
        </label>
        <div className="grid grid-cols-2 gap-3">
          <label className="block">
            <span className={labelClass}>Topic if not given</span>
            <input value={topic} onChange={(e) => setTopic(e.target.value)} list="import-topics" className={input} />
            <datalist id="import-topics">
              {topics.map((t) => (
                <option key={t} value={t} />
              ))}
            </datalist>
          </label>
          <label className="block">
            <span className={labelClass}>Difficulty if not given</span>
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
          <div className="flex flex-wrap gap-2">
            <Badge tone="success" className="!px-3 !py-1 !text-sm">
              {parsed.length - problems.length} ready
            </Badge>
            {problems.length > 0 && (
              <Badge tone="danger" className="!px-3 !py-1 !text-sm">{problems.length} with problems</Badge>
            )}
            {duplicates.length > 0 && (
              <Badge tone="warning" className="!px-3 !py-1 !text-sm">
                {duplicates.length} already in bank
              </Badge>
            )}
          </div>

          {duplicates.length > 0 && (
            <label className="flex min-h-10 items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={includeDuplicates}
                onChange={(e) => setIncludeDuplicates(e.target.checked)}
              />
              Import duplicates anyway
            </label>
          )}

          <ul className="space-y-2">
            {problems.map((p, i) => (
              <li key={`p${i}`} className="rounded-control border border-danger-200 bg-danger-50 p-3 text-sm">
                <b>{p.source}:</b> {p.error}
              </li>
            ))}
            {parsed
              .filter((p) => p.draft)
              .map((p, i) => (
                <li
                  key={`d${i}`}
                  className={`rounded-control border bg-white p-3 text-sm ${
                    p.duplicate && !includeDuplicates ? "border-warning-200 opacity-60" : "border-ink-200"
                  }`}
                >
                  <div className="mb-1 flex flex-wrap gap-1 text-xs font-semibold">
                    <span className="text-ink-600">{p.source}</span>
                    <span className="rounded-chip bg-brand-50 px-1.5 text-brand-800">
                      {ITEM_TYPE_LABEL[p.draft!.type]}
                    </span>
                    <span className="rounded-chip bg-ink-100 px-1.5 text-ink-700">
                      {DIFFICULTY_LABEL[p.draft!.difficulty]} · {p.draft!.points} pt
                    </span>
                    {p.draft!.topic && (
                      <span className="rounded-chip bg-warning-50 px-1.5 text-warning-800">{p.draft!.topic}</span>
                    )}
                    {p.duplicate && <span className="rounded-chip bg-warning-100 px-1.5 text-warning-900">Duplicate</span>}
                  </div>
                  <p className="line-clamp-3 whitespace-pre-line">{p.draft!.stem}</p>
                  {p.draft!.type === "mcq" && (
                    <p className="mt-1 text-xs text-ink-600">
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
            className="sticky bottom-3 w-full shadow-pop"
          >
            {pending
              ? "Importing…"
              : `Import ${Math.min(toImport.length, MAX)} question${toImport.length === 1 ? "" : "s"}`}
          </Button>
          {problems.length > 0 && (
            <p className="text-center text-xs text-ink-600">
              Items with problems are skipped. Fix them in the text above to include them.
            </p>
          )}
        </div>
      )}
    </div>
  );
}
