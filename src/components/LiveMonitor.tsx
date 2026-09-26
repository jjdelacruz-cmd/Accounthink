"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { endAttempt, extendAttempt, getAccessCode, getAttemptEvents, getMonitor } from "@/app/actions/monitor";
import { ExamStatusBadge } from "@/components/ExamStatusBadge";
import { END_REASON_LABEL } from "@/lib/attempts";
import {
  EVENT_LABEL,
  formatDuration,
  isFlagged,
  statusOf,
  type MonitorData,
  type MonitorEvent,
  type MonitorStudent,
  type StudentStatus,
} from "@/lib/monitor";

const POLL_MS = 5000;
const ONLINE_WINDOW_MS = 40000;

type Filter = "all" | StudentStatus | "flagged";

function clock(ms: number) {
  const t = Math.max(0, Math.ceil(ms / 1000));
  return `${Math.floor(t / 60)}:${String(t % 60).padStart(2, "0")}`;
}

// ---------------------------------------------------------------------------
// Rotating access code
// ---------------------------------------------------------------------------
function AccessCode({ examId }: { examId: string }) {
  const [code, setCode] = useState<string>();
  const [left, setLeft] = useState(0);
  const [big, setBig] = useState(false);
  const fetchedAt = useRef(0);

  const fetchCode = useCallback(async () => {
    try {
      const res = await getAccessCode(examId);
      if (res.code) {
        setCode(res.code);
        setLeft(res.seconds_left!);
        fetchedAt.current = Date.now();
      }
    } catch {
      /* retry on next tick */
    }
  }, [examId]);

  useEffect(() => {
    fetchCode();
    const t = setInterval(() => {
      setLeft((l) => {
        if (l <= 1 || Date.now() - fetchedAt.current > 65000) {
          fetchCode();
          return 0;
        }
        return l - 1;
      });
    }, 1000);
    return () => clearInterval(t);
  }, [fetchCode]);

  const digits = code ? `${code.slice(0, 3)} ${code.slice(3)}` : "··· ···";

  return (
    <>
      <div className="rounded-2xl bg-slate-900 p-4 text-center text-white">
        <p className="text-xs font-semibold uppercase tracking-widest text-slate-400">Access code</p>
        <p className="font-mono text-5xl font-bold tracking-widest tabular-nums">{digits}</p>
        <div className="mx-auto mt-2 h-1.5 max-w-48 overflow-hidden rounded-full bg-slate-700">
          <div className="h-full bg-emerald-400 transition-all" style={{ width: `${(left / 60) * 100}%` }} />
        </div>
        <p className="mt-1 text-xs text-slate-400">Changes in {left}s</p>
        <button onClick={() => setBig(true)} className="mt-2 text-sm font-semibold text-emerald-300 underline">
          Show full screen for the class
        </button>
      </div>
      {big && (
        <button
          onClick={() => setBig(false)}
          className="fixed inset-0 z-50 flex flex-col items-center justify-center bg-slate-900 text-white"
        >
          <p className="text-2xl font-semibold uppercase tracking-widest text-slate-400">Access code</p>
          <p className="font-mono text-[22vw] font-bold leading-none tabular-nums">{digits}</p>
          <p className="mt-4 text-xl text-slate-400">Changes in {left}s · tap to close</p>
        </button>
      )}
    </>
  );
}

// ---------------------------------------------------------------------------
// One student row
// ---------------------------------------------------------------------------
function StudentRow({
  s,
  total,
  now,
  onChanged,
}: {
  s: MonitorStudent;
  total: number;
  now: number;
  onChanged: () => void;
}) {
  const a = s.attempt;
  const status = statusOf(s);
  const [open, setOpen] = useState(false);
  const [events, setEvents] = useState<MonitorEvent[]>();
  const [busy, setBusy] = useState(false);

  const online = a && !a.submitted_at && a.last_seen_at && now - Date.parse(a.last_seen_at) < ONLINE_WINDOW_MS;
  const leftMs = a && !a.submitted_at ? Date.parse(a.deadline_at) - now : 0;

  const act = async (fn: () => Promise<{ error?: string }>) => {
    setBusy(true);
    try {
      const res = await fn();
      if (res.error) alert(res.error);
      onChanged();
    } finally {
      setBusy(false);
    }
  };

  const toggleLog = async () => {
    const next = !open;
    setOpen(next);
    if (next && a) {
      const res = await getAttemptEvents(a.id);
      setEvents(res.events ?? []);
    }
  };

  return (
    <li className={`rounded-xl border bg-white p-3 ${isFlagged(s) ? "border-amber-300" : "border-slate-200"}`}>
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="flex items-center gap-1.5 truncate font-semibold">
            {status === "in_progress" && (
              <span
                className={`inline-block h-2.5 w-2.5 shrink-0 rounded-full ${online ? "bg-emerald-500" : "bg-slate-300"}`}
                title={online ? "Online" : "Not responding"}
              />
            )}
            {s.full_name || "—"}
          </p>
          <p className="truncate text-xs text-slate-500">
            {[s.student_no, s.section, a?.device].filter(Boolean).join(" · ")}
          </p>
        </div>
        <div className="shrink-0 text-right">
          {status === "not_started" && (
            <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-semibold text-slate-600">
              Not started
            </span>
          )}
          {status === "in_progress" && (
            <span
              className={`font-mono text-sm font-bold tabular-nums ${leftMs < 5 * 60000 ? "text-red-600" : "text-slate-800"}`}
            >
              {clock(leftMs)}
            </span>
          )}
          {status === "submitted" && a && (
            <span className="text-sm font-bold">
              {Number(a.score)} / {Number(a.max_score)}
            </span>
          )}
        </div>
      </div>

      {a && (
        <>
          <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-slate-100">
            <div
              className={`h-full ${status === "submitted" ? "bg-slate-400" : "bg-emerald-600"}`}
              style={{ width: `${total ? (a.answered / total) * 100 : 0}%` }}
            />
          </div>
          <div className="mt-2 flex flex-wrap items-center gap-1 text-xs">
            <span className="text-slate-600">
              {a.answered}/{total} answered
            </span>
            {a.leaves > 0 && (
              <span className="rounded-md bg-amber-100 px-1.5 py-0.5 font-semibold text-amber-900">
                Left {a.leaves}× · {formatDuration(a.away_seconds)} away
              </span>
            )}
            {a.copy_paste > 0 && (
              <span className="rounded-md bg-amber-100 px-1.5 py-0.5 font-semibold text-amber-900">
                Copy/paste ×{a.copy_paste}
              </span>
            )}
            {a.device_flags > 0 && (
              <span className="rounded-md bg-red-100 px-1.5 py-0.5 font-semibold text-red-800">
                Device/tab ×{a.device_flags}
              </span>
            )}
            {a.submitted_at && a.end_reason && a.end_reason !== "student" && (
              <span className="rounded-md bg-slate-100 px-1.5 py-0.5 text-slate-700">
                {END_REASON_LABEL[a.end_reason] ?? a.end_reason}
              </span>
            )}
          </div>

          <div className="mt-2 flex flex-wrap gap-2">
            {status === "in_progress" && (
              <>
                <button
                  disabled={busy}
                  onClick={() => act(() => extendAttempt(a.id, 5))}
                  className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm font-semibold disabled:opacity-50"
                >
                  +5 min
                </button>
                <button
                  disabled={busy}
                  onClick={() => {
                    if (confirm(`End ${s.full_name}'s exam now? Their saved answers will be graded.`)) {
                      act(() => endAttempt(a.id));
                    }
                  }}
                  className="rounded-lg border border-red-300 px-3 py-1.5 text-sm font-semibold text-red-700 disabled:opacity-50"
                >
                  End now
                </button>
              </>
            )}
            <button onClick={toggleLog} className="px-1 py-1.5 text-sm font-medium text-slate-600 underline">
              {open ? "Hide log" : "Activity log"}
            </button>
          </div>

          {open && (
            <ul className="mt-2 max-h-60 space-y-1 overflow-y-auto rounded-lg bg-slate-50 p-2 text-xs">
              {!events && <li className="text-slate-500">Loading…</li>}
              {events?.length === 0 && <li className="text-slate-500">No activity recorded.</li>}
              {events?.map((e) => (
                <li key={e.id} className="flex gap-2">
                  <span className="shrink-0 tabular-nums text-slate-500">
                    {new Date(e.created_at).toLocaleTimeString("en-PH", {
                      timeZone: "Asia/Manila",
                      hour: "numeric",
                      minute: "2-digit",
                      second: "2-digit",
                    })}
                  </span>
                  <span>
                    {EVENT_LABEL[e.kind] ?? e.kind}
                    {e.kind === "returned" && typeof e.detail?.away_seconds === "number"
                      ? ` (away ${formatDuration(e.detail.away_seconds)})`
                      : ""}
                    {e.kind === "device_changed" && e.detail?.to ? `: ${String(e.detail.to)}` : ""}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </li>
  );
}

// ---------------------------------------------------------------------------
// Monitor
// ---------------------------------------------------------------------------
export function LiveMonitor({ examId }: { examId: string }) {
  const [data, setData] = useState<MonitorData>();
  const [error, setError] = useState<string>();
  const [stale, setStale] = useState(false);
  const [filter, setFilter] = useState<Filter>("all");
  const [q, setQ] = useState("");
  const offset = useRef(0);
  const [now, setNow] = useState(() => Date.now());

  const refresh = useCallback(async () => {
    try {
      const res = await getMonitor(examId);
      if (res.error) {
        setError(res.error);
        return;
      }
      offset.current = Date.parse(res.data!.server_now) - Date.now();
      setData(res.data);
      setError(undefined);
      setStale(false);
    } catch {
      setStale(true);
    }
  }, [examId]);

  useEffect(() => {
    refresh();
    const poll = setInterval(() => {
      if (document.visibilityState === "visible") refresh();
    }, POLL_MS);
    const tick = setInterval(() => setNow(Date.now() + offset.current), 1000);
    return () => {
      clearInterval(poll);
      clearInterval(tick);
    };
  }, [refresh]);

  if (error) return <p className="rounded-xl bg-red-50 p-3 text-red-800">{error}</p>;
  if (!data) return <div className="h-40 animate-pulse rounded-2xl bg-slate-200" />;

  const students = data.students;
  const counts = {
    all: students.length,
    not_started: students.filter((s) => statusOf(s) === "not_started").length,
    in_progress: students.filter((s) => statusOf(s) === "in_progress").length,
    submitted: students.filter((s) => statusOf(s) === "submitted").length,
    flagged: students.filter(isFlagged).length,
  };
  const shown = students
    .filter((s) => filter === "all" || (filter === "flagged" ? isFlagged(s) : statusOf(s) === filter))
    .filter(
      (s) =>
        !q ||
        s.full_name.toLowerCase().includes(q.toLowerCase()) ||
        (s.student_no ?? "").includes(q),
    );

  const tabs: [Filter, string][] = [
    ["all", "All"],
    ["in_progress", "Taking"],
    ["submitted", "Done"],
    ["not_started", "Not started"],
    ["flagged", "Flagged"],
  ];

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-2">
        <div>
          <p className="text-xs font-semibold uppercase text-slate-500">Live monitor</p>
          <h1 className="text-xl font-bold">{data.exam.title}</h1>
          <p className="text-xs text-slate-500">
            Updates every 5 seconds{stale && <span className="font-semibold text-amber-700"> · connection lost, retrying</span>}
          </p>
        </div>
        <ExamStatusBadge status={data.exam.status} />
      </div>

      {data.exam.require_access_code && data.exam.status === "published" && <AccessCode examId={examId} />}

      <div className="grid grid-cols-3 gap-2 text-center">
        <div className="rounded-xl bg-white p-2 shadow-sm">
          <p className="text-2xl font-bold">{counts.in_progress}</p>
          <p className="text-xs text-slate-500">Taking</p>
        </div>
        <div className="rounded-xl bg-white p-2 shadow-sm">
          <p className="text-2xl font-bold">{counts.submitted}</p>
          <p className="text-xs text-slate-500">Submitted</p>
        </div>
        <div className="rounded-xl bg-white p-2 shadow-sm">
          <p className={`text-2xl font-bold ${counts.flagged ? "text-amber-700" : ""}`}>{counts.flagged}</p>
          <p className="text-xs text-slate-500">Flagged</p>
        </div>
      </div>

      <div className="flex gap-1 overflow-x-auto rounded-xl bg-slate-200/70 p-1">
        {tabs.map(([key, label]) => (
          <button
            key={key}
            onClick={() => setFilter(key)}
            className={`shrink-0 rounded-lg px-3 py-1.5 text-sm font-semibold ${
              filter === key ? "bg-white text-emerald-800 shadow-sm" : "text-slate-600"
            }`}
          >
            {label} {counts[key]}
          </button>
        ))}
      </div>

      <input
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder="Search name or student no."
        className="block w-full rounded-xl border border-slate-300 bg-white px-3 py-2"
      />

      {shown.length === 0 ? (
        <p className="text-center text-sm text-slate-500">No students here.</p>
      ) : (
        <ul className="space-y-2">
          {shown.map((s) => (
            <StudentRow key={s.student_id} s={s} total={data.exam.total_items} now={now} onChanged={refresh} />
          ))}
        </ul>
      )}
    </div>
  );
}
