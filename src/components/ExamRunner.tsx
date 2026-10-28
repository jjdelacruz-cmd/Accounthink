"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  getQuestion,
  logEvents,
  openAttempt,
  pingAttempt,
  saveAnswer,
  submitAttempt,
} from "@/app/actions/attempts";
import { CameraWatch } from "@/components/CameraMonitor";
import { Icon } from "@/components/icons";
import { Watermark } from "@/components/Watermark";
import {
  isAnswered,
  type AttemptState,
  type IntegrityEvent,
  type Question,
  type StudentAnswer,
} from "@/lib/attempts";
import { getDeviceInfo } from "@/lib/device";
import { CHOICE_KEYS } from "@/lib/items";

type SaveStatus = "idle" | "saving" | "saved" | "offline";

const TEXT_DEBOUNCE_MS = 700;
const RETRY_MS = 3000;
const PING_MS = 15000;
const EVENT_FLUSH_MS = 5000;
const FINAL_ERRORS = ["Time is up", "This exam has been submitted"];
const KICKED_ERROR = "This exam was opened on another device";
const tokenKey = (id: string) => `attempt-token:${id}`;

function formatClock(ms: number) {
  const total = Math.max(0, Math.ceil(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  return `${h ? `${h}:` : ""}${String(m).padStart(h ? 2 : 1, "0")}:${String(s).padStart(2, "0")}`;
}

function FullScreenMessage({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-dvh flex-col items-center justify-center gap-4 bg-ink-50 px-6 text-center">
      {children}
    </div>
  );
}

function Spinner() {
  return <div className="h-10 w-10 animate-spin rounded-full border-4 border-brand-200 border-t-brand-700" />;
}

// ===========================================================================
// Gate: device check, session claim, access code, "opened elsewhere"
// ===========================================================================
type Opened = { token: string; state: AttemptState; question: Question };

export function ExamRunner({ attemptId }: { attemptId: string }) {
  const router = useRouter();
  const [opened, setOpened] = useState<Opened>();
  const [phase, setPhase] = useState<"opening" | "code" | "kicked" | "error" | "ready">("opening");
  const [error, setError] = useState<string>();
  const [code, setCode] = useState("");
  const [wrongCode, setWrongCode] = useState(false);

  const open = useCallback(
    async (withCode: string | null) => {
      setPhase("opening");
      let prev: string | null = null;
      try {
        prev = sessionStorage.getItem(tokenKey(attemptId));
      } catch {
        /* private mode */
      }
      try {
        const device = await getDeviceInfo();
        const res = await openAttempt(attemptId, device, withCode, prev);
        if ("done" in res) {
          router.replace(`/student/exams/${res.done}`);
          return;
        }
        if ("needsCode" in res) {
          setWrongCode(!!res.wrongCode);
          setPhase("code");
          return;
        }
        if ("error" in res) {
          setError(res.error);
          setPhase("error");
          return;
        }
        try {
          sessionStorage.setItem(tokenKey(attemptId), res.token);
        } catch {
          /* private mode */
        }
        setOpened(res);
        setPhase("ready");
      } catch {
        setError("Can't reach the server. Check your connection.");
        setPhase("error");
      }
    },
    [attemptId, router],
  );

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- fetch on mount: claims the session and loads the exam
    open(null);
  }, [open]);

  if (phase === "ready" && opened) {
    return (
      <Runner
        key={opened.token}
        token={opened.token}
        state={opened.state}
        firstQuestion={opened.question}
        onKicked={() => setPhase("kicked")}
      />
    );
  }

  if (phase === "code") {
    return (
      <FullScreenMessage>
        <p className="text-heading font-semibold">Enter the access code</p>
        <p className="max-w-xs text-sm text-ink-600">
          You&apos;re continuing on a different device. Ask your instructor for the current code.
        </p>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            open(code);
          }}
          className="w-full max-w-xs space-y-3"
        >
          <input
            value={code}
            onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
            inputMode="numeric"
            autoComplete="one-time-code"
            placeholder="000000"
            className="input !border-2 text-center font-mono text-3xl tracking-[0.4em]"
          />
          {wrongCode && <p className="text-sm text-danger-700">That code is wrong or expired.</p>}
          <button className="btn btn-primary w-full">Continue</button>
        </form>
      </FullScreenMessage>
    );
  }

  if (phase === "kicked") {
    return (
      <FullScreenMessage>
        <p className="text-heading font-semibold">This exam is open on another device or tab</p>
        <p className="max-w-xs text-sm text-ink-600">
          Only one screen can hold your exam at a time. Continuing here moves it to this screen, and your
          instructor will see that it moved.
        </p>
        <button
          onClick={() => open(null)}
          className="btn btn-primary w-full max-w-xs"
        >
          Continue here
        </button>
      </FullScreenMessage>
    );
  }

  if (phase === "error") {
    return (
      <FullScreenMessage>
        <p className="text-heading font-semibold">{error}</p>
        <button
          onClick={() => open(null)}
          className="btn btn-primary w-full max-w-xs"
        >
          Try again
        </button>
      </FullScreenMessage>
    );
  }

  return (
    <FullScreenMessage>
      <Spinner />
      <p className="text-ink-600">Opening your exam…</p>
    </FullScreenMessage>
  );
}

// ===========================================================================
// Runner: the exam itself
// ===========================================================================
function Runner({
  token,
  state,
  firstQuestion,
  onKicked,
}: {
  token: string;
  state: AttemptState;
  firstQuestion: Question;
  onKicked: () => void;
}) {
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
  const [finishing, setFinishing] = useState<false | "manual" | "timeout" | "leave_limit">(false);
  const [leaves, setLeaves] = useState(state.leave_count);
  const [leaveWarning, setLeaveWarning] = useState(false);
  const [blockedNotice, setBlockedNotice] = useState<string>();

  // Server clock offset so a wrong phone clock can't change the timer.
  const offset = useRef(Date.parse(state.server_now) - Date.now());
  const [deadline, setDeadline] = useState(Date.parse(state.deadline_at));
  const [remaining, setRemaining] = useState(() => deadline - (Date.now() + offset.current));

  const pending = useRef(new Map<number, StudentAnswer>());
  const timers = useRef(new Map<number, ReturnType<typeof setTimeout>>());
  const inFlight = useRef(false);
  const finished = useRef(false);
  const loading = useRef(new Set<number>());
  const eventQueue = useRef<IntegrityEvent[]>([]);
  const leftAt = useRef<number | null>(null);

  const forget = () => {
    try {
      sessionStorage.removeItem(`attempt-token:${attemptId}`);
    } catch {
      /* private mode */
    }
  };

  // ---- finishing ---------------------------------------------------------
  const finish = useCallback(
    async (reason: "manual" | "timeout" | "leave_limit") => {
      if (finished.current) return;
      finished.current = true;
      setFinishing(reason);
      timers.current.forEach(clearTimeout);
      for (const [i, a] of pending.current) {
        try {
          await saveAnswer(attemptId, token, i, a);
        } catch {
          /* graded with what the server has */
        }
      }
      for (;;) {
        try {
          const res = await submitAttempt(attemptId, token);
          if (res.error === KICKED_ERROR) {
            finished.current = false;
            onKicked();
            return;
          }
          forget();
          router.replace(`/student/exams/${res.examId ?? state.exam_id}`);
          return;
        } catch {
          await new Promise((r) => setTimeout(r, RETRY_MS));
        }
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [attemptId, token, router, state.exam_id, onKicked],
  );

  /** Shared handling for errors from any exam call. Returns true if handled. */
  const handleFatal = useCallback(
    (message?: string) => {
      if (!message) return false;
      if (message === KICKED_ERROR) {
        finished.current = true;
        onKicked();
        return true;
      }
      if (FINAL_ERRORS.includes(message)) {
        finish("timeout");
        return true;
      }
      return false;
    },
    [finish, onKicked],
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
      const res = await saveAnswer(attemptId, token, i, a);
      inFlight.current = false;
      if (res.error) {
        if (handleFatal(res.error)) return;
        throw new Error(res.error);
      }
      if (pending.current.get(i) === a) pending.current.delete(i);
      setSaveStatus(pending.current.size ? "saving" : "saved");
      if (pending.current.size) flush();
    } catch {
      inFlight.current = false;
      setSaveStatus("offline");
      setTimeout(flush, RETRY_MS);
    }
  }, [attemptId, token, handleFatal]);

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

  // ---- integrity events --------------------------------------------------
  const flushEvents = useCallback(async () => {
    if (finished.current || eventQueue.current.length === 0) return;
    const batch = eventQueue.current.splice(0, 50);
    try {
      const res = await logEvents(attemptId, token, batch);
      if (res.error) {
        if (handleFatal(res.error)) return;
        throw new Error(res.error);
      }
      if (res.ended) finish("leave_limit");
    } catch {
      eventQueue.current.unshift(...batch); // retry next round
    }
  }, [attemptId, token, finish, handleFatal]);

  const record = useCallback((e: IntegrityEvent) => {
    if (finished.current) return;
    eventQueue.current.push({ ...e, detail: { ...e.detail, at: new Date().toISOString() } });
  }, []);

  useEffect(() => {
    const t = setInterval(flushEvents, EVENT_FLUSH_MS);
    return () => clearInterval(t);
  }, [flushEvents]);

  // Leaving the app / tab.
  useEffect(() => {
    const onVisibility = () => {
      if (finished.current) return;
      if (document.visibilityState === "hidden") {
        leftAt.current = Date.now();
        record({ kind: "left_app" });
        setLeaves((n) => n + 1);
        flushEvents(); // may not complete if the OS suspends the page; retried on return
      } else if (leftAt.current !== null) {
        const away = Math.round((Date.now() - leftAt.current) / 1000);
        leftAt.current = null;
        record({ kind: "returned", detail: { away_seconds: away } });
        setLeaveWarning(true);
        flushEvents();
      }
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => document.removeEventListener("visibilitychange", onVisibility);
  }, [record, flushEvents]);

  // Copy / paste / long-press menu / screenshot key.
  useEffect(() => {
    let lastMenu = 0;
    const block = (kind: IntegrityEvent["kind"], message: string) => (e: Event) => {
      e.preventDefault();
      if (kind === "context_menu") {
        if (Date.now() - lastMenu < 5000) return; // long-press fires repeatedly
        lastMenu = Date.now();
      }
      record({ kind });
      setBlockedNotice(message);
    };
    const onCopy = block("copy", "Copying is disabled during the exam.");
    const onCut = block("cut", "Copying is disabled during the exam.");
    const onPaste = block("paste", "Pasting is disabled during the exam.");
    const onMenu = block("context_menu", "This menu is disabled during the exam.");
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "PrintScreen") record({ kind: "print_key" });
    };
    document.addEventListener("copy", onCopy);
    document.addEventListener("cut", onCut);
    document.addEventListener("paste", onPaste);
    document.addEventListener("contextmenu", onMenu);
    document.addEventListener("keyup", onKey);
    return () => {
      document.removeEventListener("copy", onCopy);
      document.removeEventListener("cut", onCut);
      document.removeEventListener("paste", onPaste);
      document.removeEventListener("contextmenu", onMenu);
      document.removeEventListener("keyup", onKey);
    };
  }, [record]);

  useEffect(() => {
    if (!blockedNotice) return;
    const t = setTimeout(() => setBlockedNotice(undefined), 2500);
    return () => clearTimeout(t);
  }, [blockedNotice]);

  // ---- loading questions -------------------------------------------------
  const load = useCallback(
    async (i: number) => {
      if (questions[i] || loading.current.has(i) || i < 0 || i >= total) return;
      loading.current.add(i);
      try {
        const res = await getQuestion(attemptId, token, i);
        if (res.error) {
          if (!handleFatal(res.error)) setLoadError(res.error);
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
    [attemptId, token, handleFatal, questions, total],
  );

  const goTo = (i: number) => {
    if (i < 0 || i >= total) return;
    clearTimeout(timers.current.get(index));
    flush();
    setLoadError(undefined);
    setShowNav(false);
    setIndex(i);
    window.scrollTo({ top: 0 });
  };

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- fetch on mount/navigation: loads the current and next question
    load(index);
    load(index + 1);
  }, [index, load]);

  // ---- timer + heartbeat -------------------------------------------------
  useEffect(() => {
    const t = setInterval(() => {
      const left = deadline - (Date.now() + offset.current);
      setRemaining(left);
      if (left <= 0) finish("timeout");
    }, 1000);
    return () => clearInterval(t);
  }, [deadline, finish]);

  useEffect(() => {
    const t = setInterval(async () => {
      if (finished.current) return;
      try {
        const res = await pingAttempt(attemptId, token);
        if (res.error) {
          handleFatal(res.error);
          return;
        }
        offset.current = Date.parse(res.server_now!) - Date.now();
        setDeadline(Date.parse(res.deadline_at!)); // picks up extra time from the instructor
      } catch {
        /* offline; the save indicator already says so */
      }
    }, PING_MS);
    return () => clearInterval(t);
  }, [attemptId, token, handleFatal]);

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
  const watermark = `${state.student_name}${state.student_no ? ` · ${state.student_no}` : ""}`;

  if (finishing) {
    return (
      <FullScreenMessage>
        <Spinner />
        <p className="text-heading font-semibold">
          {finishing === "timeout" && "Time is up. Submitting your answers…"}
          {finishing === "manual" && "Submitting…"}
          {finishing === "leave_limit" && "You left the exam too many times. Submitting your answers…"}
        </p>
        <p className="text-sm text-ink-600">Keep this page open.</p>
      </FullScreenMessage>
    );
  }

  return (
    <div className="min-h-dvh select-none bg-ink-50 pb-28 [-webkit-touch-callout:none]">
      <Watermark text={watermark} />
      {state.require_camera && (
        <CameraWatch
          finishedRef={finished}
          onEpisode={(kind, seconds) => {
            record({ kind, detail: seconds === null ? { phase: "start" } : { phase: "end", seconds } });
            flushEvents();
          }}
        />
      )}

      <header className="sticky top-0 z-20 border-b border-ink-200 bg-white/95 shadow-card backdrop-blur">
        <div className="mx-auto flex max-w-2xl items-center justify-between gap-3 px-4 py-2.5">
          <div className="min-w-0">
            <p className="truncate text-base font-semibold text-ink-900">{state.title}</p>
            <p className="text-xs tabular-nums text-ink-600">
              {answered.size} of {total} answered
              {saveStatus === "saving" && " · Saving…"}
              {saveStatus === "saved" && " · Saved ✓"}
              {saveStatus === "offline" && (
                <span className="font-semibold text-warning-800"> · Offline, will retry</span>
              )}
            </p>
          </div>
          <div
            className={`flex shrink-0 items-center gap-1.5 rounded-full border px-3 py-1.5 font-mono text-xl font-bold tabular-nums ${
              lowTime ? "border-danger-600 bg-danger-600 text-white" : "border-brand-200 bg-brand-50 text-brand-900"
            }`}
            role="timer"
            aria-label="Time left"
          >
            <Icon name="clock" size={18} />
            {formatClock(remaining)}
          </div>
        </div>
        <div className="h-1 bg-ink-100" aria-hidden>
          <div className="h-full bg-brand-600 transition-[width]" style={{ width: `${total ? (answered.size / total) * 100 : 0}%` }} />
        </div>
      </header>

      <main className="relative mx-auto max-w-2xl space-y-4 px-4 py-5">
        {leaveWarning && (
          <div className="notice notice-error relative z-20 !block">
            <p className="font-semibold">You left the exam screen.</p>
            <p>
              This was recorded and your instructor can see it (left {leaves} time{leaves === 1 ? "" : "s"}).
              {state.leave_limit !== null &&
                ` After ${state.leave_limit} times, your exam is submitted automatically.`}
            </p>
            <button onClick={() => setLeaveWarning(false)} className="btn btn-outline-danger btn-sm mt-2">
              OK
            </button>
          </div>
        )}

        <p className="text-sm font-semibold tabular-nums text-ink-600">
          Question {index + 1} of {total}
          {q && ` · ${Number(q.points)} pt${Number(q.points) === 1 ? "" : "s"}`}
        </p>

        {loadError && (
          <div className="notice notice-warn !block">
            {loadError}{" "}
            <button
              className="font-semibold underline"
              onClick={() => {
                setLoadError(undefined);
                load(index);
              }}
            >
              Try again
            </button>
          </div>
        )}

        {!q && !loadError && <div className="h-40 animate-pulse rounded-card bg-ink-200" />}

        {q && (
          <div className="card space-y-5 !p-4 sm:!p-5">
            <p className="whitespace-pre-line text-question font-medium text-ink-900">{q.stem}</p>

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
                      className={`flex min-h-14 w-full items-start gap-3 rounded-control border-2 p-3 text-left text-base leading-snug ${
                        selected
                          ? "border-brand-600 bg-brand-50 text-ink-900 shadow-card"
                          : "border-ink-300 bg-white text-ink-800 hover:border-ink-400 hover:bg-ink-50"
                      }`}
                    >
                      <span
                        className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-sm font-bold ${
                          selected ? "bg-brand-700 text-white" : "bg-ink-100 text-ink-700"
                        }`}
                      >
                        {CHOICE_KEYS[i]}
                      </span>
                      <span className="flex-1 pt-1">{c.text}</span>
                      {selected && <Icon name="check" size={22} className="mt-1 text-brand-700" />}
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
                className="input !border-2 select-text !text-lg"
              />
            )}

            {q.type === "essay" && (
              <div className="space-y-1">
                <textarea
                  value={answer && "text" in answer ? (answer.text ?? "") : ""}
                  onChange={(e) => setAnswer(index, { text: e.target.value }, true)}
                  onBlur={() => flush()}
                  placeholder="Write your answer"
                  rows={8}
                  autoComplete="off"
                  autoCorrect="off"
                  spellCheck={false}
                  maxLength={10000}
                  className="input !border-2 select-text leading-relaxed"
                />
                <p className="text-right text-xs tabular-nums text-ink-600">
                  {(answer && "text" in answer ? (answer.text ?? "") : "").length} / 10,000 · checked by your instructor
                </p>
              </div>
            )}

            {q.type === "enumeration" && (
              <div className="space-y-2">
                <p className="text-sm text-ink-600">Give {q.slots} answers.</p>
                {Array.from({ length: q.slots ?? 0 }, (_, i) => {
                  const items = answer && "items" in answer ? (answer.items ?? []) : [];
                  return (
                    <div key={i} className="flex items-center gap-2">
                      <span className="w-6 shrink-0 text-right font-semibold tabular-nums text-ink-600">{i + 1}.</span>
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
                        className="input !border-2 select-text"
                      />
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}
      </main>

      {blockedNotice && (
        <div className="fixed inset-x-0 bottom-24 z-30 flex justify-center px-4">
          <p className="rounded-full bg-ink-900 px-4 py-2.5 text-sm font-medium text-white shadow-pop">{blockedNotice}</p>
        </div>
      )}

      <nav className="fixed inset-x-0 bottom-0 z-20 border-t border-ink-200 bg-white shadow-pop pb-[env(safe-area-inset-bottom)]">
        <div className="mx-auto flex max-w-2xl items-center gap-2 px-4 py-3">
          <button
            onClick={() => goTo(index - 1)}
            disabled={index === 0}
            className="btn btn-secondary btn-lg flex-1 !text-base"
          >
            ← Prev
          </button>
          <button
            onClick={() => setShowNav(true)}
            className="btn btn-secondary btn-lg !px-3 !text-base tabular-nums"
            aria-label="All questions"
          >
            {index + 1}/{total}
          </button>
          {index < total - 1 ? (
            <button
              onClick={() => goTo(index + 1)}
              className="btn btn-primary btn-lg flex-1 !text-base"
            >
              Next →
            </button>
          ) : (
            <button
              onClick={() => setConfirmSubmit(true)}
              className="btn btn-primary btn-lg flex-1 !text-base"
            >
              Submit
            </button>
          )}
        </div>
      </nav>

      {showNav && (
        <div className="fixed inset-0 z-30 flex items-end bg-ink-950/50" onClick={() => setShowNav(false)}>
          <div
            className="mx-auto max-h-[80dvh] w-full max-w-2xl overflow-y-auto rounded-t-card bg-white p-4 shadow-pop"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mb-3 flex items-center justify-between">
              <p className="font-semibold">
                {answered.size} of {total} answered
              </p>
              <button onClick={() => setShowNav(false)} className="btn btn-quiet !min-h-10 !min-w-10 !px-2" aria-label="Close">
                <Icon name="x" size={20} />
              </button>
            </div>
            <div className="grid grid-cols-6 gap-2 sm:grid-cols-10">
              {Array.from({ length: total }, (_, i) => (
                <button
                  key={i}
                  onClick={() => goTo(i)}
                  className={`aspect-square rounded-chip text-sm font-semibold tabular-nums ${
                    answered.has(i) ? "bg-brand-700 text-white" : "bg-ink-100 text-ink-700"
                  } ${i === index ? "ring-2 ring-ink-900 ring-offset-2" : ""}`}
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
              className="btn btn-primary mt-4 w-full"
            >
              Submit exam
            </button>
          </div>
        </div>
      )}

      {confirmSubmit && (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-ink-950/50 px-6">
          <div className="w-full max-w-sm space-y-4 rounded-card bg-white p-5 shadow-pop">
            <p className="text-heading font-semibold">Submit your exam?</p>
            {unanswered > 0 ? (
              <p className="text-sm text-warning-800">
                You have <b>{unanswered}</b> unanswered question{unanswered === 1 ? "" : "s"}.
              </p>
            ) : (
              <p className="text-sm text-ink-600">All questions answered.</p>
            )}
            <p className="text-sm text-ink-600">You can&apos;t change your answers after submitting.</p>
            <div className="flex gap-2">
              <button
                onClick={() => setConfirmSubmit(false)}
                className="btn btn-secondary flex-1"
              >
                Go back
              </button>
              <button
                onClick={() => finish("manual")}
                className="btn btn-primary flex-1"
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
