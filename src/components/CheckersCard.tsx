"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { addChecker, removeChecker } from "@/app/actions/checkers";
import { Card, Notice } from "@/components/ui";

type Checker = { checker_id: string; full_name: string; email: string | null };

/** Instructor: who else may score this exam's answers. They see only this exam's answers. */
export function CheckersCard({ courseId, examId, checkers }: { courseId: string; examId: string; checkers: Checker[] }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [email, setEmail] = useState("");
  const [msg, setMsg] = useState<{ ok: boolean; text: string }>();

  return (
    <Card className="space-y-3">
      <div>
        <h2 className="font-semibold">Checkers</h2>
        <p className="text-sm text-slate-600">
          A checker is a separate account that can score the essay, identification and enumeration answers of this exam
          only, after students have taken it. They can&apos;t see your item bank, other exams or the results. The admin
          makes an account a checker under <b>Manage users</b>.
        </p>
      </div>
      {checkers.length > 0 && (
        <ul className="divide-y divide-slate-100 rounded-xl border border-slate-200">
          {checkers.map((c) => (
            <li key={c.checker_id} className="flex items-center justify-between gap-2 px-3 py-2">
              <div className="min-w-0">
                <p className="truncate font-semibold">{c.full_name || "—"}</p>
                <p className="truncate text-xs text-slate-500">{c.email}</p>
              </div>
              <button
                type="button"
                disabled={pending}
                onClick={() =>
                  start(async () => {
                    const r = await removeChecker(courseId, examId, c.checker_id);
                    setMsg(r.error ? { ok: false, text: r.error } : { ok: true, text: `${c.full_name || "Checker"} removed.` });
                    router.refresh();
                  })
                }
                className="shrink-0 rounded-lg px-2 py-1 text-sm font-semibold text-red-700 disabled:opacity-50"
              >
                Remove
              </button>
            </li>
          ))}
        </ul>
      )}
      <form
        className="flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          start(async () => {
            const r = await addChecker(courseId, examId, email);
            if (r.error) setMsg({ ok: false, text: r.error });
            else {
              setMsg({ ok: true, text: `${r.name || "Checker"} can now check this exam.` });
              setEmail("");
              router.refresh();
            }
          });
        }}
      >
        <input
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="Checker's email"
          aria-label="Checker's email"
          required
          className="min-h-11 w-full rounded-xl border border-slate-300 bg-white px-3 text-base"
        />
        <button
          disabled={pending}
          className="min-h-11 shrink-0 rounded-xl bg-emerald-700 px-4 text-sm font-semibold text-white disabled:opacity-50"
        >
          Add
        </button>
      </form>
      {msg && <Notice kind={msg.ok ? "ok" : "error"}>{msg.text}</Notice>}
    </Card>
  );
}
