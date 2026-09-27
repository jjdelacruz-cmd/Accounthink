"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState, useTransition } from "react";
import { acceptAnswer, regradeExam, setPassingPercent } from "@/app/actions/results";
import { ActionForm } from "@/components/ActionForm";
import { Notice } from "@/components/ui";
import { END_REASON_LABEL } from "@/lib/attempts";
import { CHOICE_KEYS, ITEM_TYPE_LABEL } from "@/lib/items";
import { isFlagged, type MonitorData, type MonitorStudent } from "@/lib/monitor";
import {
  buildWorkbook,
  difficultyLabel,
  discriminationLabel,
  keyText,
  pct,
  round1,
  safeFileName,
  scoreStats,
  verdict,
  type AnalysisItem,
  type ItemAnalysis,
} from "@/lib/results";

type Sort = "name" | "high" | "low" | "section";

function Tile({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="rounded-xl bg-white p-3 shadow-sm">
      <p className="text-xs text-slate-500">{label}</p>
      <p className="text-2xl font-bold tabular-nums">{value}</p>
      {sub && <p className="text-xs text-slate-500">{sub}</p>}
    </div>
  );
}

/** Score distribution: one series, bars anchored to the baseline, hover for counts. */
function Histogram({ buckets, passing }: { buckets: number[]; passing: number | null }) {
  const [hover, setHover] = useState<number | null>(null);
  const max = Math.max(1, ...buckets);
  return (
    <figure className="rounded-xl bg-white p-3 shadow-sm">
      <figcaption className="mb-2 text-sm font-semibold">Score distribution (% of total)</figcaption>
      <div className="relative">
        <div className="flex h-32 items-end gap-0.5 border-b border-slate-300" role="img" aria-label="Score distribution">
          {buckets.map((n, i) => {
            const below = passing !== null && (i + 1) * 10 <= passing;
            return (
              <div
                key={i}
                className="relative flex h-full flex-1 items-end"
                onMouseEnter={() => setHover(i)}
                onMouseLeave={() => setHover(null)}
                onClick={() => setHover(hover === i ? null : i)}
              >
                <div
                  className={`w-full rounded-t ${below ? "bg-emerald-300" : "bg-emerald-600"} ${hover === i ? "opacity-80" : ""}`}
                  style={{ height: n ? `${Math.max(4, (n / max) * 100)}%` : 0 }}
                />
                {hover === i && (
                  <div
                    className={`absolute bottom-full z-10 mb-1 whitespace-nowrap rounded-md bg-slate-900 px-2 py-1 text-xs text-white ${
                      i < 3 ? "left-0" : i > 6 ? "right-0" : "left-1/2 -translate-x-1/2"
                    }`}
                  >
                    {i * 10}–{i === 9 ? 100 : i * 10 + 9}%: <b>{n}</b> student{n === 1 ? "" : "s"}
                  </div>
                )}
              </div>
            );
          })}
        </div>
        <div className="mt-1 flex gap-0.5 text-[10px] text-slate-500">
          {buckets.map((_, i) => (
            <span key={i} className="flex-1 text-center tabular-nums">
              {i * 10}
            </span>
          ))}
        </div>
      </div>
      {passing !== null && (
        <p className="mt-1 text-xs text-slate-500">Lighter bars are below the passing mark ({passing}%).</p>
      )}
      {/* Table view for screen readers */}
      <table className="sr-only">
        <tbody>
          {buckets.map((n, i) => (
            <tr key={i}>
              <td>
                {i * 10}–{i === 9 ? 100 : i * 10 + 9}%
              </td>
              <td>{n}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </figure>
  );
}

function Meter({ value, className = "bg-emerald-600" }: { value: number; className?: string }) {
  return (
    <div className="h-2 flex-1 overflow-hidden rounded-full bg-slate-100">
      <div className={`h-full rounded-full ${className}`} style={{ width: `${Math.max(0, Math.min(100, value))}%` }} />
    </div>
  );
}

function ItemCard({
  it,
  n,
  submitted,
  courseId,
  examId,
}: {
  it: AnalysisItem;
  n: number;
  submitted: number;
  courseId: string;
  examId: string;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [err, setErr] = useState<string>();
  const v = verdict(it);
  const vStyle =
    v.level === "check"
      ? "bg-red-50 text-red-900 border-red-200"
      : v.level === "revise"
        ? "bg-amber-50 text-amber-900 border-amber-200"
        : "bg-slate-50 text-slate-700 border-slate-200";
  const vIcon = v.level === "check" ? "⚠" : v.level === "revise" ? "✎" : "✓";
  const correctKey = it.key && "correct" in it.key ? it.key.correct : null;

  return (
    <li className="space-y-3 rounded-xl border border-slate-200 bg-white p-3">
      <div className="flex items-start justify-between gap-2">
        <p className="text-xs font-semibold text-slate-500">
          {n}. {ITEM_TYPE_LABEL[it.type]} · {Number(it.points)} pt
        </p>
        <Link
          href={`/instructor/courses/${courseId}/items/${it.item_id}`}
          className="shrink-0 text-xs font-semibold text-emerald-700"
        >
          Edit item
        </Link>
      </div>
      <p className="line-clamp-4 whitespace-pre-line text-sm">{it.stem}</p>

      <div className="space-y-1.5 text-xs">
        <div className="flex items-center gap-2">
          <span className="w-[5.5rem] shrink-0 text-slate-600">% correct</span>
          <Meter value={(it.p ?? 0) * 100} />
          <span className="w-32 shrink-0 text-right font-semibold tabular-nums">
            {it.p === null ? "—" : `${round1(it.p * 100)}%`} · {difficultyLabel(it.p)}
          </span>
        </div>
        <div className="flex items-center gap-2">
          <span className="w-[5.5rem] shrink-0 text-slate-600">Discrimination</span>
          <Meter value={it.d === null ? 0 : Math.max(0, it.d) * 100} className={it.d !== null && it.d < 0 ? "bg-red-500" : "bg-slate-500"} />
          <span className="w-32 shrink-0 text-right font-semibold tabular-nums">
            {it.d === null ? "—" : it.d.toFixed(2)} · {discriminationLabel(it.d)}
          </span>
        </div>
        {it.n_blank > 0 && <p className="text-slate-500">{it.n_blank} left it blank.</p>}
      </div>

      {it.type === "mcq" && it.choices && (
        <div className="space-y-1">
          {it.choices.map((c, i) => {
            const count = it.choice_counts?.[c.key] ?? 0;
            const isKey = c.key === correctKey;
            return (
              <div key={c.key} className={`flex items-center gap-2 text-xs ${isKey ? "font-semibold" : ""}`}>
                <span className={`w-5 shrink-0 ${isKey ? "text-emerald-800" : ""}`}>{CHOICE_KEYS[i]}.</span>
                <span className="w-2/5 shrink-0 truncate" title={c.text}>
                  {c.text}
                </span>
                <Meter value={submitted ? (count / submitted) * 100 : 0} className={isKey ? "bg-emerald-600" : "bg-slate-400"} />
                <span className="w-16 shrink-0 text-right tabular-nums">
                  {count}
                  {isKey ? " ✓ key" : count === 0 ? " · none" : ""}
                </span>
              </div>
            );
          })}
        </div>
      )}

      {it.type !== "mcq" && (
        <p className="text-xs">
          <span className="font-semibold">Key:</span> {keyText(it)}
        </p>
      )}

      {it.type === "identification" && !!it.wrong_answers?.length && (
        <div className="space-y-1">
          <p className="text-xs font-semibold text-slate-600">Most common wrong answers</p>
          {it.wrong_answers.map((w) => (
            <div key={w.text} className="flex items-center justify-between gap-2 rounded-lg bg-slate-50 px-2 py-1 text-xs">
              <span className="min-w-0 truncate">
                “{w.text}” <span className="text-slate-500">×{w.n}</span>
              </span>
              <button
                disabled={pending}
                onClick={() => {
                  if (!confirm(`Accept “${w.text}” as correct and re-grade everyone?`)) return;
                  setErr(undefined);
                  start(async () => {
                    const res = await acceptAnswer(courseId, examId, it.item_id, w.text);
                    if (res.error) setErr(res.error);
                    else router.refresh();
                  });
                }}
                className="shrink-0 rounded-md border border-emerald-600 px-2 py-0.5 font-semibold text-emerald-800 disabled:opacity-50"
              >
                Accept as correct
              </button>
            </div>
          ))}
          {err && <p className="text-xs text-red-700">{err}</p>}
        </div>
      )}

      <p className={`rounded-lg border px-2 py-1.5 text-xs ${vStyle}`}>
        {vIcon} {v.text}
      </p>
    </li>
  );
}

export function ResultsView({
  courseId,
  examId,
  courseCode,
  examTitle,
  passingPercent,
  monitor,
  analysis,
}: {
  courseId: string;
  examId: string;
  courseCode: string;
  examTitle: string;
  passingPercent: number | null;
  monitor: MonitorData;
  analysis: ItemAnalysis;
}) {
  const router = useRouter();
  const [tab, setTab] = useState<"scores" | "items">("scores");
  const [sort, setSort] = useState<Sort>("name");
  const [q, setQ] = useState("");
  const [busy, start] = useTransition();
  const [notice, setNotice] = useState<{ kind: "ok" | "error"; text: string }>();

  const students = monitor.students;
  const stats = scoreStats(students, passingPercent);

  const rows = useMemo(() => {
    const score = (s: MonitorStudent) =>
      s.attempt?.submitted_at ? pct(Number(s.attempt.score), Number(s.attempt.max_score)) : -1;
    const list = students.filter(
      (s) => !q || s.full_name.toLowerCase().includes(q.toLowerCase()) || (s.student_no ?? "").includes(q),
    );
    return [...list].sort((a, b) => {
      if (sort === "high") return score(b) - score(a) || a.full_name.localeCompare(b.full_name);
      if (sort === "low") {
        const sa = score(a) < 0 ? 999 : score(a);
        const sb = score(b) < 0 ? 999 : score(b);
        return sa - sb || a.full_name.localeCompare(b.full_name);
      }
      if (sort === "section") return (a.section ?? "").localeCompare(b.section ?? "") || a.full_name.localeCompare(b.full_name);
      return a.full_name.localeCompare(b.full_name);
    });
  }, [students, q, sort]);

  async function download() {
    const { default: writeXlsxFile } = await import("write-excel-file/browser");
    const sheets = buildWorkbook(students, analysis, passingPercent);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const blob = await writeXlsxFile(sheets as any).toBlob();
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `${safeFileName(`${courseCode} ${examTitle} results`)}.xlsx`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  function regrade() {
    if (!confirm("Re-grade every submitted attempt with the current answer keys and points?")) return;
    setNotice(undefined);
    start(async () => {
      const res = await regradeExam(courseId, examId);
      if (res.error) setNotice({ kind: "error", text: res.error });
      else {
        setNotice({ kind: "ok", text: `Re-graded ${res.count} attempt${res.count === 1 ? "" : "s"}.` });
        router.refresh();
      }
    });
  }

  const tabBtn = (key: "scores" | "items", label: string) => (
    <button
      onClick={() => setTab(key)}
      className={`flex-1 rounded-lg px-3 py-2 text-sm font-semibold ${
        tab === key ? "bg-white text-emerald-800 shadow-sm" : "text-slate-600"
      }`}
    >
      {label}
    </button>
  );

  return (
    <div className="space-y-4">
      <div>
        <p className="text-xs font-semibold uppercase text-slate-500">Results</p>
        <h1 className="text-xl font-bold">{examTitle}</h1>
      </div>

      {stats ? (
        <>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            <Tile label="Took the exam" value={`${stats.submitted}/${stats.roster}`}
              sub={[stats.inProgress && `${stats.inProgress} in progress`, stats.notTaken && `${stats.notTaken} not taken`].filter(Boolean).join(" · ") || undefined} />
            <Tile label="Average" value={`${round1(stats.mean)}%`} sub={`${round1(stats.meanScore)} of ${stats.maxScore}`} />
            <Tile label="Highest / Lowest" value={`${round1(stats.high)}%`} sub={`lowest ${round1(stats.low)}% · median ${round1(stats.median)}%`} />
            <Tile
              label="Passed"
              value={stats.passed === null ? "—" : `${stats.passed}/${stats.submitted}`}
              sub={passingPercent === null ? "set a passing mark below" : `at ${passingPercent}% and above`}
            />
          </div>
          <Histogram buckets={stats.buckets} passing={passingPercent} />
        </>
      ) : (
        <p className="rounded-xl bg-white p-4 text-center text-slate-600 shadow-sm">No one has submitted yet.</p>
      )}

      <div className="flex flex-col gap-2 sm:flex-row">
        <button
          onClick={download}
          className="min-h-12 flex-1 rounded-xl bg-emerald-700 px-4 font-semibold text-white"
        >
          ⬇ Download Excel
        </button>
        <button
          onClick={regrade}
          disabled={busy}
          className="min-h-12 flex-1 rounded-xl border border-slate-300 bg-white px-4 font-semibold disabled:opacity-50"
        >
          {busy ? "Re-grading…" : "↻ Re-grade all"}
        </button>
      </div>
      {notice && <Notice kind={notice.kind}>{notice.text}</Notice>}

      <details className="rounded-xl bg-white p-3 shadow-sm">
        <summary className="cursor-pointer text-sm font-semibold">
          Passing mark: {passingPercent === null ? "not set" : `${passingPercent}%`}
        </summary>
        <ActionForm action={setPassingPercent} submitLabel="Save" resetOnSuccess={false} className="mt-3 space-y-2">
          <input type="hidden" name="exam_id" value={examId} />
          <input type="hidden" name="course_id" value={courseId} />
          <label className="flex items-center gap-2 text-sm">
            <input
              name="passing_percent"
              type="number"
              inputMode="decimal"
              min={0}
              max={100}
              step="0.5"
              defaultValue={passingPercent ?? ""}
              placeholder="e.g. 60"
              className="w-28 rounded-xl border border-slate-300 px-3 py-2"
            />
            % and above passes (blank = no pass/fail)
          </label>
        </ActionForm>
      </details>

      <nav className="flex gap-1 rounded-xl bg-slate-200/70 p-1">
        {tabBtn("scores", `Scores (${students.length})`)}
        {tabBtn("items", `Item analysis (${analysis.items.length})`)}
      </nav>

      {tab === "scores" ? (
        <div className="space-y-2">
          <div className="flex gap-2">
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Search name or student no."
              className="min-w-0 flex-1 rounded-xl border border-slate-300 bg-white px-3 py-2"
            />
            <select
              value={sort}
              onChange={(e) => setSort(e.target.value as Sort)}
              className="rounded-xl border border-slate-300 bg-white px-2 py-2 text-sm"
              aria-label="Sort"
            >
              <option value="name">Name</option>
              <option value="high">Highest first</option>
              <option value="low">Lowest first</option>
              <option value="section">Section</option>
            </select>
          </div>
          <ul className="divide-y divide-slate-100 overflow-hidden rounded-xl border border-slate-200 bg-white">
            {rows.map((s) => {
              const a = s.attempt;
              const done = !!a?.submitted_at;
              const p = done ? pct(Number(a!.score), Number(a!.max_score)) : null;
              const passed = p !== null && passingPercent !== null ? p >= passingPercent : null;
              const body = (
                <div className="flex items-center justify-between gap-2 p-3">
                  <div className="min-w-0">
                    <p className={`truncate font-semibold ${a ? "" : "text-slate-400"}`}>{s.full_name || "—"}</p>
                    <p className="truncate text-xs text-slate-500">
                      {[s.student_no, s.section].filter(Boolean).join(" · ")}
                      {isFlagged(s) && <span className="font-semibold text-amber-700"> · flagged</span>}
                      {done && a!.end_reason && a!.end_reason !== "student" && (
                        <span> · {END_REASON_LABEL[a!.end_reason] ?? a!.end_reason}</span>
                      )}
                    </p>
                  </div>
                  <div className="shrink-0 text-right">
                    {done ? (
                      <>
                        <p className="font-bold tabular-nums">
                          {Number(a!.score)}/{Number(a!.max_score)}
                        </p>
                        <p className="text-xs tabular-nums text-slate-600">
                          {round1(p!)}%
                          {passed !== null && (
                            <span className={passed ? " text-emerald-700" : " font-semibold text-red-700"}>
                              {passed ? " · Passed" : " · Failed"}
                            </span>
                          )}
                        </p>
                      </>
                    ) : (
                      <p className="text-xs font-semibold text-slate-500">{a ? "In progress" : "Did not take"}</p>
                    )}
                  </div>
                </div>
              );
              return (
                <li key={s.student_id}>
                  {a ? (
                    <Link
                      href={`/instructor/courses/${courseId}/exams/${examId}/results/${a.id}`}
                      className="block hover:bg-slate-50"
                    >
                      {body}
                    </Link>
                  ) : (
                    body
                  )}
                </li>
              );
            })}
          </ul>
          <p className="text-center text-xs text-slate-500">Tap a student to see their answers.</p>
        </div>
      ) : (
        <div className="space-y-2">
          <p className="text-xs text-slate-600">
            <b>% correct</b>: share of points earned (blank counts as 0). <b>Discrimination</b>: % correct among the top{" "}
            27% minus the bottom 27%; 0.40+ very good, 0.30 good, 0.20 fair, below 0.20 poor, negative means check the
            key.
            {analysis.group_size === 0 && " Discrimination needs at least 4 submissions."} After editing an item&apos;s
            key, tap <b>Re-grade all</b>.
          </p>
          <ol className="space-y-2">
            {analysis.items.map((it, i) => (
              <ItemCard
                key={it.item_id}
                it={it}
                n={i + 1}
                submitted={analysis.submitted}
                courseId={courseId}
                examId={examId}
              />
            ))}
          </ol>
        </div>
      )}
    </div>
  );
}
