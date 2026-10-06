"use client";

import { useState } from "react";
import type { FeedbackItem } from "@/lib/attempts";
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
  right: { card: "border-emerald-200", badge: "bg-emerald-100 text-emerald-800", icon: "✓", word: "Correct" },
  partial: { card: "border-amber-200", badge: "bg-amber-100 text-amber-900", icon: "½", word: "Partly correct" },
  wrong: { card: "border-red-200", badge: "bg-red-100 text-red-800", icon: "✗", word: "Wrong" },
  pending: { card: "border-slate-200", badge: "bg-slate-100 text-slate-700", icon: "…", word: "Being checked" },
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
          ? "bg-emerald-50 font-semibold text-emerald-900"
          : mine
            ? right
              ? "bg-emerald-50 font-semibold text-emerald-900"
              : "bg-red-50 text-red-900"
            : "text-slate-700";
        return (
          <li key={c.key} className={`flex gap-2 rounded-lg px-2 py-1.5 text-sm ${cls}`}>
            <span className="w-5 shrink-0">{CHOICE_KEYS[i]}.</span>
            <span className="flex-1">{c.text}</span>
            {mine && <span className="shrink-0 text-xs font-semibold">your answer</span>}
            {isKey && !mine && <span className="shrink-0 text-xs font-semibold">correct answer</span>}
          </li>
        );
      })}
      {!picked && <li className="px-2 text-sm italic text-slate-500">You left this blank.</li>}
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
        {given.length ? given.join("; ") : <span className="italic text-slate-500">blank</span>}
      </p>
      {showAnswers && keyText && m !== "right" && m !== "pending" && (
        <p className="text-emerald-800">
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
      <div className="flex items-end justify-between gap-2">
        <h2 className="text-lg font-bold">Your answers</h2>
        <p className="text-sm text-slate-600">
          <span className="font-semibold text-emerald-700">{right} right</span>
          {partial > 0 && <span className="font-semibold text-amber-700"> · {partial} partly</span>}
          <span className="font-semibold text-red-700"> · {wrong} wrong</span>
          {pending > 0 && <span className="font-semibold text-slate-600"> · {pending} being checked</span>}
        </p>
      </div>

      <div className="flex gap-1 rounded-xl bg-slate-200/70 p-1">
        {[
          [false, `All (${items.length})`],
          [true, `Mistakes only (${mistakes})`],
        ].map(([v, label]) => (
          <button
            key={String(v)}
            type="button"
            onClick={() => setMistakesOnly(v as boolean)}
            className={`flex-1 rounded-lg px-3 py-2 text-sm font-semibold ${
              mistakesOnly === v ? "bg-white text-emerald-800 shadow-sm" : "text-slate-600"
            }`}
          >
            {label as string}
          </button>
        ))}
      </div>

      {shown.length === 0 && <p className="text-center text-sm text-slate-600">No mistakes. Well done!</p>}

      <ol className="space-y-2">
        {shown.map((it) => {
          const m = mark(it);
          const s = STYLE[m];
          return (
            <li key={it.index} className={`space-y-2 rounded-xl border bg-white p-3 ${s.card}`}>
              <div className="flex items-start justify-between gap-2">
                <p className="text-xs font-semibold text-slate-500">
                  {it.index}. {ITEM_TYPE_LABEL[it.type]}
                </p>
                <span className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-bold ${s.badge}`}>
                  {s.icon} {s.word}
                  {m === "pending" ? ` · ${Number(it.points)} pts` : ` · ${Number(it.points_awarded)}/${Number(it.points)}`}
                </span>
              </div>
              <p className="whitespace-pre-line">{it.stem}</p>
              {it.type === "mcq" ? <Choices it={it} /> : <Written it={it} showAnswers={showAnswers} />}
              {it.comment && (
                <p className="rounded-lg bg-sky-50 px-3 py-2 text-sm text-sky-900">
                  <span className="font-semibold">Instructor:</span> {it.comment}
                </p>
              )}
            </li>
          );
        })}
      </ol>
      {!showAnswers && (
        <p className="text-center text-xs text-slate-500">Your instructor chose not to show the correct answers.</p>
      )}
    </section>
  );
}
