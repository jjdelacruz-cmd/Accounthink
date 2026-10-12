"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { setResponseScore } from "@/app/actions/results";
import type { ItemType } from "@/lib/items";

/** Set the points for one student's answer by hand, with an optional comment for the student. */
export function ScoreEditor({
  courseId,
  examId,
  attemptId,
  itemId,
  type,
  max,
  points,
  manual,
  comment,
  scoredBy,
}: {
  courseId: string;
  examId: string;
  attemptId: string;
  itemId: string;
  type: ItemType;
  max: number;
  points: number | null;
  manual: boolean;
  comment: string | null;
  /** Name of whoever set the score by hand (a checker, or the instructor). */
  scoredBy?: string | null;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [value, setValue] = useState(points === null ? "" : String(Number(points)));
  const [note, setNote] = useState(comment ?? "");
  const [showNote, setShowNote] = useState(!!comment);
  const [status, setStatus] = useState<{ ok: boolean; text: string }>();

  const save = (p: number | null) => {
    setStatus(undefined);
    start(async () => {
      const res = await setResponseScore(courseId, examId, attemptId, itemId, p, note);
      if (res.error) {
        setStatus({ ok: false, text: res.error });
        return;
      }
      if (p === null) setValue("");
      setStatus({ ok: true, text: `Saved ✓ · total ${Number(res.score)}/${Number(res.max_score)}` });
      router.refresh();
    });
  };

  const fromInput = () => {
    const n = Number(value);
    if (value.trim() === "" || !Number.isFinite(n)) {
      setStatus({ ok: false, text: "Enter the points first." });
      return;
    }
    save(n);
  };

  const quick = (n: number) => {
    setValue(String(n));
    save(n);
  };

  return (
    <div className="space-y-2 rounded-xl bg-slate-50 p-2">
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          disabled={pending}
          onClick={() => quick(0)}
          className="min-h-10 rounded-lg border border-red-200 bg-white px-3 text-sm font-semibold text-red-700 disabled:opacity-50"
        >
          ✗ 0
        </button>
        {max > 1 && (
          <button
            type="button"
            disabled={pending}
            onClick={() => quick(Math.round((max / 2) * 2) / 2)}
            className="min-h-10 rounded-lg border border-amber-200 bg-white px-3 text-sm font-semibold text-amber-800 disabled:opacity-50"
          >
            ½ {Math.round((max / 2) * 2) / 2}
          </button>
        )}
        <button
          type="button"
          disabled={pending}
          onClick={() => quick(max)}
          className="min-h-10 rounded-lg border border-emerald-200 bg-white px-3 text-sm font-semibold text-emerald-800 disabled:opacity-50"
        >
          ✓ {max}
        </button>
        <span className="flex items-center gap-1">
          <input
            type="number"
            inputMode="decimal"
            min={0}
            max={max}
            step={0.5}
            value={value}
            onChange={(e) => setValue(e.target.value)}
            aria-label="Points"
            className="min-h-10 w-20 rounded-lg border border-slate-300 bg-white px-2 text-base"
          />
          <span className="text-sm text-slate-500">/ {max}</span>
        </span>
        <button
          type="button"
          disabled={pending}
          onClick={fromInput}
          className="min-h-10 rounded-lg bg-emerald-700 px-3 text-sm font-semibold text-white disabled:opacity-50"
        >
          {pending ? "Saving…" : "Save"}
        </button>
      </div>

      {showNote ? (
        <textarea
          value={note}
          onChange={(e) => setNote(e.target.value)}
          rows={2}
          maxLength={2000}
          placeholder="Comment for the student (optional, saved with the score)"
          className="block w-full rounded-lg border border-slate-300 bg-white px-2 py-1.5 text-sm"
        />
      ) : (
        <button type="button" onClick={() => setShowNote(true)} className="text-xs font-semibold text-emerald-700">
          + Add a comment for the student
        </button>
      )}

      <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
        {status ? (
          <span className={status.ok ? "font-semibold text-emerald-700" : "font-semibold text-red-700"}>{status.text}</span>
        ) : (
          <span className="text-slate-500">
            {manual ? `Scored by ${scoredBy ?? "you"}` : points === null ? "Not checked yet" : "Automatic score from the key"}
          </span>
        )}
        {manual && (
          <button type="button" disabled={pending} onClick={() => save(null)} className="font-semibold text-slate-600 underline">
            {type === "essay" ? "Undo (mark as not checked)" : "Undo (use the key's score)"}
          </button>
        )}
      </div>
    </div>
  );
}
