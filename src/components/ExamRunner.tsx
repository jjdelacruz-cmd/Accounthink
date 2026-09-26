"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { getQuestion, saveAnswer, submitAttempt } from "@/app/actions/attempts";
import { isAnswered, type AttemptState, type Question, type StudentAnswer } from "@/lib/attempts";
import { CHOICE_KEYS } from "@/lib/items";

type SaveStatus = "idle" | "saving" | "saved" | "offline";

const TEXT_DEBOUNCE_MS = 700;
const RETRY_MS = 3000;
// Errors that mean the attempt is over; anything else is treated as a network problem.
const FINAL_ERRORS = ["Time is up", "This exam has been submitted"];

function formatClock(ms: number) {
  const total = Math.max(0, Math.ceil(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const mm = String(m).padStart(h ? 2 : 1, "0");
  return `${h ? `${h}:` : ""}${mm}:${String(s).padStart(2, "0")}`;
}

export function ExamRunner({ state, firstQuestion }: { state: AttemptState; firstQuestion: Question }) {
  const router = useRouter();
  const attemptId = state.attempt_id;
  const total = state.total;

  const [index, setIndex] = useState(0);
  const [questions, setQuestions] = useState<Record<number, Question>>({ 0: firstQuestion });
  const [answers, setAnswers] = useState<Record<number, StudentAnswer>>(
    firstQuestion.answer ? { 0: firstQuestion.answer } : {},
  );
  const [answered, setAnswered] = useState<Set<number>>(new Set(state.answered));
  const [saveStatus, setSaveStatus] = useState<SaveStatus>("idle");
  const [loadError, setLoadError] = useState<string>();
  const [showNav, setShowNav] = useState(false);
  const [confirmSubmit, setConfirmSubmit] = useState(false);
  const [finishing, setFinishing] = useState<false | "manual" | "timeout">(false);

  // Server clock offset so a wrong phone clock can't change the timer.
  const offset = useRef(Date.parse(state.server_now) - Date.now());
  const deadline = Date.parse(state.deadline_at);
  const [remaining, setRemaining] = useState(() => deadline - (Date.now() + offset.current));

  // Unsaved answers by question index, plus debounce timers.
  const pending = useRef(new Map<number, StudentAnswer>());
  const timers = useRef(new Map<number, ReturnType<typeof setTimeout>>());
  const inFlight = useRef(false);
  const finished = useRef(false);
  const loading = useRef(new Set<number>());

  // ---- finishing ---------------------------------------------------------
  const finish = useCallback(
    async (reason: "manual" | "timeout") => {
      if (finished.current) return;
      finished.current = true;
      setFinishing(reason);
      timers.current.forEach(clearTimeout);
      // Best effort: push anything unsaved before grading.
      for (const [i, a] of pending.current) {
        try {
          await saveAnswer(attemptId, i, a);
        } catch {
          /* graded with what the server has */
        }
      }
      for (;;) {
        try {
          const res = await submitAttempt(attemptId);
          router.replace(res.examId ? `/student/exams/${res.examId}` : `/student/exams/${state.exam_id}`);
          return;
        } catch {
          await new Promise((r) => setTimeout(r, RETRY_MS)); // offline: keep trying
        }
      }
    },
    [attemptId, router, state.exam_id],
  );

  // ---- saving ------------------------------------------------------------
  const flush = useCallback(async () => {
    if (inFlight.current || finished.current) return;
    const next = pending.current.entries().next();
    if (next.done) {
      setSaveStatus((s) => (s === "saving" ? "saved" : s));
      return;
    }
    const [i, a] = next.value;
    inFlight.current = true;
    setSaveStatus("saving");
    try {
      const res = await saveAnswer(attemptId, i, a);
      if (res.error) {
        if (FINAL_ERRORS.includes(res.error)) {
          inFlight.current = false;
          finish("timeout");
          return;
        }
        throw new Error(res.error);
      }
      // Only clear if the student didn't change it again meanwhile.
      if (pending.current.get(i) === a) pending.current.delete(i);
      inFlight.current = false;
      setSaveStatus(pending.current.size ? "saving" : "saved");
      if (pending.current.size) flush();
    } catch {
      inFlight.current = false;
      setSaveStatus("offline");
      setTimeout(flush, RETRY_MS);
    }
  }, [attemptId, finish]);

  const setAnswer = useCallback(
    (i: number, a: StudentAnswer, debounce: boolean) => {
      if (finished.current) return;
      setAnswers((prev) => ({ ...prev, [i]: a }));
      setAnswered((prev) => {
        const next = new Set(prev);
        if (isAnswered(a)) next.add(i);
        else next.delete(i);
        return next;
      });
      pending.current.set(i, a);
      clearTimeout(timers.current.get(i));
      if (debounce) {
        setSaveStatus("saving");
        timers.current.set(i, setTimeout(flush, TEXT_DEBOUNCE_MS));
      } else {
        flush();
      }
    },
    [flush],
  );

  // ---- loading questions -------------------------------------------------
  const load = useCallback(
    async (i: number) => {
      if (questions[i] || loading.current.has(i) || i < 0 || i >= total) return;
      loading.current.add(i);
      try {
        const res = await getQuestion(attemptId, i);
        if (res.error) {
          if (FINAL_ERRORS.includes(res.error)) finish("timeout");
          else setLoadError(res.error);
          return;
        }
        const q = res.question!;
        setQuestions((prev) => ({ ...prev, [i]: q }));
        if (q.answer) setAnswers((prev) => (i in prev ? prev : { ...prev, [i]: q.answer! }));
      } catch {
        setLoadError("Can't load this question. Check your connection.");
      } finally {
        loading.current.delete(i);
      }
    },
    [attemptId, finish, questions, total],
  );

  const goTo = (i: number) => {
    if (i < 0 || i >= total) return;
    // Save the current typed answer right away instead of waiting for the debounce.
    clearTimeout(timers.current.get(index));
    flush();
    setLoadError(undefined);
    setShowNav(false);
    setIndex(i);
    window.scrollTo({ top: 0 });
  };

  useEffect(() => {
    load(index);
    load(index + 1); // prefetch
  }, [index, load]);

  // ---- timer -------------------------------------------------------------
  useEffect(() => {
    const t = setInterval(() => {
      const left = deadline - (Date.now() + offset.current);
      setRemaining(left);
      if (left <= 0) finish("timeout");
    }, 1000);
    return () => clearInterval(t);
  }, [deadline, finish]);

  // Warn before closing the tab with unsaved answers.
  useEffect(() => {
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      if (pending.current.size && !finished.current) e.preventDefault();
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, []);

  // ---- render ------------------------------------------------------------
  const q = questions[index];
  const answer = answers[index];
  const unanswered = total - answered.size;
  const lowTime = remaining < 5 * 60 * 1000;

  if (finishing) {
    return (
      <div className="flex min-h-dvh flex-col items-center justify-center gap-3 bg-slate-50 px-6 text-center">
        <div className="h-10 w-10 animate-spin rounded-full border-4 border-emerald-200 border-t-emerald-700" />
        <p className="text-lg font-semibold">
          {finishing === "timeout" ? "Time is up. Submitting your answers…" : "Submitting…"}
        </p>
        <p className="text-sm text-slate-500">Keep this page open.</p>
      </div>
    );
  }

  return (
    <div className="min-h-dvh bg-slate-50 pb-28">
      {/* Top bar */}
      <header className="sticky top-0 z-20 border-b border-slate-200 bg-white/95 backdrop-blur">
        <div className="mx-auto flex max-w-2xl items-center justify-between gap-3 px-4 py-2">
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold">{state.title}</p>
            <p className="text-xs text-slate-500">
              {answered.size} of {total} answered
              {saveStatus === "saving" && " · Saving…"}
              {saveStatus === "saved" && " · Saved ✓"}
              {saveStatus === "offline" && (
                <span className="font-semibold text-amber-700"> · Offline, will retry</span>
              )}
            </p>
          </div>
          <div
            className={`shrink-0 rounded-full px-3 py-1.5 font-mono text-lg font-bold tabular-nums ${
              lowTime ? "bg-red-600 text-white" : "bg-slate-900 text-white"
            }`}
            role="timer"
            aria-label="Time left"
          >
            {formatClock(remaining)}
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-2xl space-y-4 px-4 py-4">
        <p className="text-sm font-semibold text-slate-500">
          Question {index + 1} of {total}
          {q && ` · ${Number(q.points)} pt${Number(q.points) === 1 ? "" : "s"}`}
        </p>

        {loadError && (
          <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
            {loadError}{" "}
            <button className="font-semibold underline" onClick={() => { setLoadError(undefined); load(index); }}>
              Try again
            </button>
          </div>
        )}

        {!q && !loadError && <div className="h-40 animate-pulse rounded-2xl bg-slate-200" />}

        {q && (
          <div className="space-y-4 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
            <p className="whitespace-pre-line text-lg leading-relaxed">{q.stem}</p>

            {q.type === "mcq" && (
              <div className="space-y-2" role="radiogroup">
                {q.choices?.map((c, i) => {
                  const selected = answer && "choice" in answer && answer.choice === c.key;
                  return (
                    <button
                      key={c.key}
                      role="radio"
                      aria-checked={!!selected}
                      onClick={() => setAnswer(index, { choice: c.key }, false)}
                      className={`flex w-full items-start gap-3 rounded-xl border-2 p-3 text-left text-base ${
                        selected ? "border-emerald-600 bg-emerald-50" : "border-slate-200 bg-white"
                      }`}
                    >
                      <span
                        className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-sm font-bold ${
                          selected ? "bg-emerald-700 text-white" : "bg-slate-100 text-slate-700"
                        }`}
                      >
                        {CHOICE_KEYS[i]}
                      </span>
                      <span className="pt-0.5">{c.text}</span>
                    </button>
                  );
                })}
              </div>
            )}

            {q.type === "identification" && (
              <input
                value={answer && "text" in answer ? (answer.text ?? "") : ""}
                onChange={(e) => setAnswer(index, { text: e.target.value }, true)}
                onBlur={() => flush()}
                placeholder="Type your answer"
                autoComplete="off"
                autoCorrect="off"
                spellCheck={false}
                maxLength={500}
                className="block w-full rounded-xl border-2 border-slate-300 px-3 py-3 text-lg outline-none focus:border-emerald-600"
              />
            )}

            {q.type === "enumeration" && (
              <div className="space-y-2">
                <p className="text-sm text-slate-500">Give {q.slots} answers.</p>
                {Array.from({ length: q.slots ?? 0 }, (_, i) => {
                  const items = answer && "items" in answer ? (answer.items ?? []) : [];
                  return (
                    <div key={i} className="flex items-center gap-2">
                      <span className="w-6 shrink-0 text-right font-semibold text-slate-500">{i + 1}.</span>
                      <input
                        value={items[i] ?? ""}
                        onChange={(e) => {
                          const next = Array.from({ length: q.slots ?? 0 }, (_, j) => items[j] ?? "");
                          next[i] = e.target.value;
                          setAnswer(index, { items: next }, true);
                        }}
                        onBlur={() => flush()}
                        autoComplete="off"
                        autoCorrect="off"
                        spellCheck={false}
                        maxLength={200}
                        className="block w-full rounded-xl border-2 border-slate-300 px-3 py-3 text-base outline-none focus:border-emerald-600"
                      />
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}
      </main>

      {/* Bottom bar */}
      <nav className="fixed inset-x-0 bottom-0 z-20 border-t border-slate-200 bg-white">
        <div className="mx-auto flex max-w-2xl items-center gap-2 px-4 py-3">
          <button
            onClick={() => goTo(index - 1)}
            disabled={index === 0}
            className="min-h-12 flex-1 rounded-xl border border-slate-300 font-semibold disabled:opacity-40"
          >
            ← Prev
          </button>
          <button
            onClick={() => setShowNav(true)}
            className="min-h-12 rounded-xl border border-slate-300 px-4 font-semibold tabular-nums"
            aria-label="All questions"
          >
            {index + 1}/{total}
          </button>
          {index < total - 1 ? (
            <button
              onClick={() => goTo(index + 1)}
              className="min-h-12 flex-1 rounded-xl bg-emerald-700 font-semibold text-white"
            >
              Next →
            </button>
          ) : (
            <button
              onClick={() => setConfirmSubmit(true)}
              className="min-h-12 flex-1 rounded-xl bg-emerald-700 font-semibold text-white"
            >
              Submit
            </button>
          )}
        </div>
      </nav>

      {/* Question navigator */}
      {showNav && (
        <div className="fixed inset-0 z-30 flex items-end bg-black/40" onClick={() => setShowNav(false)}>
          <div
            className="max-h-[80dvh] w-full overflow-y-auto rounded-t-2xl bg-white p-4"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mb-3 flex items-center justify-between">
              <p className="font-semibold">
                {answered.size} of {total} answered
              </p>
              <button onClick={() => setShowNav(false)} className="px-2 py-1 text-slate-500" aria-label="Close">
                ✕
              </button>
            </div>
            <div className="grid grid-cols-6 gap-2 sm:grid-cols-10">
              {Array.from({ length: total }, (_, i) => (
                <button
                  key={i}
                  onClick={() => goTo(i)}
                  className={`aspect-square rounded-lg text-sm font-semibold ${
                    answered.has(i) ? "bg-emerald-700 text-white" : "bg-slate-100 text-slate-700"
                  } ${i === index ? "ring-2 ring-slate-900 ring-offset-2" : ""}`}
                >
                  {i + 1}
                </button>
              ))}
            </div>
            <button
              onClick={() => {
                setShowNav(false);
                setConfirmSubmit(true);
              }}
              className="mt-4 min-h-12 w-full rounded-xl bg-emerald-700 font-semibold text-white"
            >
              Submit exam
            </button>
          </div>
        </div>
      )}

      {/* Submit confirmation */}
      {confirmSubmit && (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/40 px-6">
          <div className="w-full max-w-sm space-y-4 rounded-2xl bg-white p-5">
            <p className="text-lg font-semibold">Submit your exam?</p>
            {unanswered > 0 ? (
              <p className="text-sm text-amber-800">
                You have <b>{unanswered}</b> unanswered question{unanswered === 1 ? "" : "s"}.
              </p>
            ) : (
              <p className="text-sm text-slate-600">All questions answered.</p>
            )}
            <p className="text-sm text-slate-600">You can&apos;t change your answers after submitting.</p>
            <div className="flex gap-2">
              <button
                onClick={() => setConfirmSubmit(false)}
                className="min-h-12 flex-1 rounded-xl border border-slate-300 font-semibold"
              >
                Go back
              </button>
              <button
                onClick={() => finish("manual")}
                className="min-h-12 flex-1 rounded-xl bg-emerald-700 font-semibold text-white"
              >
                Submit
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
