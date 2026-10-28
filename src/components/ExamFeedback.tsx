"use client";

import { useState } from "react";
import type { FeedbackItem } from "@/lib/attempts";
import { SectionTitle } from "@/components/ui";
import { CHOICE_KEYS, ITEM_TYPE_LABEL } from "@/lib/items";

function mark(it: FeedbackItem) {
  if (it.points_awarded === null) return "pending" as const;
  const earned = Number(it.points_awarded);
  const max = Number(it.points);
  if (earned >= max) return "right" as const;
  if (earned > 0) return "partial" as const;
  return "wrong" as const;
}

const STYLE = {
  right: { card: "border-l-brand-600", badge: "badge-success", icon: "✓", word: "Correct" },
  partial: { card: "border-l-warning-500", badge: "badge-warning", icon: "½", word: "Partly correct" },
  wrong: { card: "border-l-danger-600", badge: "badge-danger", icon: "✗", word: "Wrong" },
  pending: { card: "border-l-ink-400", badge: "badge-neutral", icon: "…", word: "Being checked" },
};

function Choices({ it }: { it: FeedbackItem }) {
  const picked = (it.answer as { choice?: string } | null)?.choice;
  const right = mark(it) === "right";
  return (
    <ul className="space-y-1">
      {it.choices?.map((c, i) => {
        const mine = picked === c.key;
        const isKey = c.is_key === true;
        const cls = isKey
          ? "bg-brand-50 font-semibold text-brand-900"
          : mine
            ? right
              ? "bg-brand-50 font-semibold text-brand-900"
              : "bg-danger-50 text-danger-900"
            : "text-ink-700";
        return (
          <li key={c.key} className={`flex gap-2 rounded-chip px-2 py-1.5 text-sm ${cls}`}>
            <span className="w-5 shrink-0">{CHOICE_KEYS[i]}.</span>
            <span className="flex-1">{c.text}</span>
            {mine && <span className="shrink-0 text-xs font-semibold">your answer</span>}
            {isKey && !mine && <span className="shrink-0 text-xs font-semibold">correct answer</span>}
          </li>
        );
      })}
      {!picked && <li className="px-2 text-sm italic text-ink-600">You left this blank.</li>}
    </ul>
  );
}

function Written({ it, showAnswers }: { it: FeedbackItem; showAnswers: boolean }) {
  const a = it.answer as { text?: string; items?: string[] } | null;
  const given =
    it.type === "enumeration" ? (a?.items ?? []).filter((x) => x.trim()) : a?.text?.trim() ? [a.text] : [];
  const k = it.key;
  const keyText = !k
    ? null
    : "accepted" in k
      ? k.accepted.join(" / ")
      : "answers" in k
        ? `${k.answers.map((alts) => alts.join(" / ")).join("; ")}${k.any_order === false ? " (in this order)" : ""}`
        : k.guide || null;
  const m = mark(it);
  return (
    <div className="space-y-1 text-sm">
      <p className={it.type === "essay" ? "whitespace-pre-line" : ""}>
        <span className="font-semibold">Your answer:</span>
        {it.type === "essay" ? <br /> : " "}
        {given.length ? given.join("; ") : <span className="italic text-ink-600">blank</span>}
      </p>
      {showAnswers && keyText && m !== "right" && m !== "pending" && (
        <p className="text-brand-800">
          <span className="font-semibold">{it.type === "essay" ? "A good answer covers:" : "Correct answer:"}</span>{" "}
          {keyText}
        </p>
      )}
    </div>
  );
}

export function ExamFeedback({ items, showAnswers }: { items: FeedbackItem[]; showAnswers: boolean }) {
  const [mistakesOnly, setMistakesOnly] = useState(false);
  const right = items.filter((it) => mark(it) === "right").length;
  const wrong = items.filter((it) => mark(it) === "wrong").length;
  const pending = items.filter((it) => mark(it) === "pending").length;
  const partial = items.length - right - wrong - pending;
  const mistakes = wrong + partial;
  const shown = mistakesOnly ? items.filter((it) => ["wrong", "partial"].includes(mark(it))) : items;

  return (
    <section className="space-y-3">
      <div className="flex flex-wrap items-end justify-between gap-x-3 gap-y-1">
        <SectionTitle>Your answers</SectionTitle>
        <p className="text-sm text-ink-600">
          <span className="font-semibold text-brand-800">{right} right</span>
          {partial > 0 && <span className="font-semibold text-warning-800"> · {partial} partly</span>}
          <span className="font-semibold text-danger-700"> · {wrong} wrong</span>
          {pending > 0 && <span className="font-semibold text-ink-600"> · {pending} being checked</span>}
        </p>
      </div>

      <div className="tabs grid-cols-2">
        {[
          [false, `All (${items.length})`],
          [true, `Mistakes only (${mistakes})`],
        ].map(([v, label]) => (
          <button
            key={String(v)}
            type="button"
            onClick={() => setMistakesOnly(v as boolean)}
            aria-pressed={mistakesOnly === v}
            className="tab"
          >
            {label as string}
          </button>
        ))}
      </div>

      {shown.length === 0 && <p className="text-center text-sm text-ink-600">No mistakes. Well done!</p>}

      <ol className="space-y-3">
        {shown.map((it) => {
          const m = mark(it);
          const s = STYLE[m];
          return (
            <li key={it.index} className={`card space-y-2 !p-3 border-l-4 sm:!p-4 ${s.card}`}>
              <div className="flex items-start justify-between gap-2">
                <p className="text-xs font-semibold text-ink-600">
                  {it.index}. {ITEM_TYPE_LABEL[it.type]}
                </p>
                <span className={`badge shrink-0 ${s.badge}`}>
                  {s.icon} {s.word}
                  {m === "pending" ? ` · ${Number(it.points)} pts` : ` · ${Number(it.points_awarded)}/${Number(it.points)}`}
                </span>
              </div>
              <p className="whitespace-pre-line text-base text-ink-900">{it.stem}</p>
              {it.type === "mcq" ? <Choices it={it} /> : <Written it={it} showAnswers={showAnswers} />}
              {it.comment && (
                <p className="rounded-chip bg-info-50 px-3 py-2 text-sm text-info-900">
                  <span className="font-semibold">Instructor:</span> {it.comment}
                </p>
              )}
            </li>
          );
        })}
      </ol>
      {!showAnswers && (
        <p className="text-center text-xs text-ink-600">Your instructor chose not to show the correct answers.</p>
      )}
    </section>
  );
}
