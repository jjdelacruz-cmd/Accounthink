"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { dismissScoreUpdates } from "@/app/actions/notices";
import { formatManila } from "@/lib/time";

export type ScoreUpdate = {
  attempt_id: string;
  exam_id: string;
  exam_title: string;
  course_code: string;
  old_score: number | null;
  new_score: number;
  max_score: number;
  by_hand: boolean;
  at: string;
};

/** "Your score changed" notices on the student's dashboard, until they tap Got it. */
export function ScoreUpdates({ updates }: { updates: ScoreUpdate[] }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [hidden, setHidden] = useState(false);
  if (hidden || updates.length === 0) return null;

  return (
    <section aria-label="Score updates" className="space-y-2 rounded-2xl border border-sky-200 bg-sky-50 p-3">
      <h2 className="font-semibold text-sky-900">Your score was updated</h2>
      <ul className="space-y-2">
        {updates.map((u) => {
          const up = u.old_score === null || Number(u.new_score) >= Number(u.old_score);
          return (
            <li key={u.attempt_id} className="rounded-xl bg-white px-3 py-2 text-sm">
              <Link href={`/student/exams/${u.exam_id}`} className="font-semibold text-slate-900">
                {u.course_code} · {u.exam_title}
              </Link>
              <p className="mt-0.5">
                {u.old_score !== null && (
                  <>
                    <span className="text-slate-500 line-through">{Number(u.old_score)}</span>
                    {" → "}
                  </>
                )}
                <span className={`text-lg font-bold ${up ? "text-emerald-700" : "text-red-700"}`}>{Number(u.new_score)}</span>
                <span className="text-slate-500"> / {Number(u.max_score)}</span>
              </p>
              <p className="text-xs text-slate-500">
                {u.by_hand
                  ? "Your instructor checked or adjusted your answers."
                  : "Scores were re-graded after the answer key was corrected."}{" "}
                {formatManila(u.at)}
              </p>
            </li>
          );
        })}
      </ul>
      <button
        type="button"
        disabled={pending}
        onClick={() =>
          start(async () => {
            const res = await dismissScoreUpdates();
            if (!res.error) {
              setHidden(true);
              router.refresh();
            }
          })
        }
        className="min-h-11 w-full rounded-xl border border-sky-300 bg-white px-4 text-sm font-semibold text-sky-900 disabled:opacity-50"
      >
        {pending ? "…" : "Got it"}
      </button>
    </section>
  );
}
