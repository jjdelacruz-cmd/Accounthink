"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { dismissScoreUpdates } from "@/app/actions/notices";
import { Icon } from "@/components/icons";
import { Button } from "@/components/ui";
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
    <section aria-label="Score updates" className="space-y-3 rounded-card border border-info-200 bg-info-50 p-3 sm:p-4">
      <h2 className="flex items-center gap-2 font-semibold text-info-900">
        <Icon name="chart" size={20} />
        Your score was updated
      </h2>
      <ul className="space-y-2">
        {updates.map((u) => {
          const up = u.old_score === null || Number(u.new_score) >= Number(u.old_score);
          return (
            <li key={u.attempt_id} className="rounded-control border border-info-100 bg-white px-3 py-2.5 text-sm shadow-card">
              <Link href={`/student/exams/${u.exam_id}`} className="font-semibold text-ink-900 hover:underline">
                {u.course_code} · {u.exam_title}
              </Link>
              <p className="mt-0.5 tabular-nums">
                {u.old_score !== null && (
                  <>
                    <span className="text-ink-600 line-through">{Number(u.old_score)}</span>
                    {" → "}
                  </>
                )}
                <span className={`text-lg font-bold ${up ? "text-brand-700" : "text-danger-700"}`}>{Number(u.new_score)}</span>
                <span className="text-ink-600"> / {Number(u.max_score)}</span>
              </p>
              <p className="text-xs text-ink-600">
                {u.by_hand
                  ? "Your instructor checked or adjusted your answers."
                  : "Scores were re-graded after the answer key was corrected."}{" "}
                {formatManila(u.at)}
              </p>
            </li>
          );
        })}
      </ul>
      <Button
        type="button"
        variant="secondary"
        block
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
      >
        {pending ? "…" : "Got it"}
      </Button>
    </section>
  );
}
