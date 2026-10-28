"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { setResponseScore } from "@/app/actions/results";
import { inputClass } from "@/components/ui";
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
      setStatus({
        ok: true,
        text: `Saved ✓ · total ${Number(res.score)}/${Number(res.max_score)}${res.notify ? " · student will be notified" : ""}`,
      });
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
    <div className="space-y-2 rounded-control border border-ink-200 bg-ink-50 p-2.5">
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          disabled={pending}
          onClick={() => quick(0)}
          className="btn btn-outline-danger btn-sm"
        >
          ✗ 0
        </button>
        {max > 1 && (
          <button
            type="button"
            disabled={pending}
            onClick={() => quick(Math.round((max / 2) * 2) / 2)}
            className="btn btn-sm !border-warning-300 !bg-white !text-warning-800 hover:!bg-warning-50"
          >
            ½ {Math.round((max / 2) * 2) / 2}
          </button>
        )}
        <button
          type="button"
          disabled={pending}
          onClick={() => quick(max)}
          className="btn btn-sm !border-brand-300 !bg-white !text-brand-800 hover:!bg-brand-50"
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
            className={`${inputClass} input-sm !w-20`}
          />
          <span className="text-sm text-ink-600 tabular-nums">/ {max}</span>
        </span>
        <button
          type="button"
          disabled={pending}
          onClick={fromInput}
          className="btn btn-primary btn-sm"
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
          className={`${inputClass} input-sm`}
        />
      ) : (
        <button type="button" onClick={() => setShowNote(true)} className="btn btn-ghost btn-sm -ml-2">
          + Add a comment for the student
        </button>
      )}

      <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
        {status ? (
          <span className={status.ok ? "font-semibold text-brand-800" : "font-semibold text-danger-700"}>{status.text}</span>
        ) : (
          <span className="text-ink-600">
            {manual ? `Scored by ${scoredBy ?? "you"}` : points === null ? "Not checked yet" : "Automatic score from the key"}
          </span>
        )}
        {manual && (
          <button type="button" disabled={pending} onClick={() => save(null)} className="min-h-10 px-1 font-semibold text-ink-700 underline">
            {type === "essay" ? "Undo (mark as not checked)" : "Undo (use the key's score)"}
          </button>
        )}
      </div>
    </div>
  );
}
