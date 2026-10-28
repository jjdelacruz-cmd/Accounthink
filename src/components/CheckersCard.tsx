"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { addChecker, removeChecker } from "@/app/actions/checkers";
import { Card, Notice, SectionTitle, inputClass } from "@/components/ui";

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
        <SectionTitle>Checkers</SectionTitle>
        <p className="text-sm text-ink-600">
          A checker is a separate account that can score the essay, identification and enumeration answers of this exam
          only, after students have taken it. They can&apos;t see your item bank, other exams or the results. The admin
          makes an account a checker under <b>Manage users</b>.
        </p>
      </div>
      {checkers.length > 0 && (
        <ul className="list">
          {checkers.map((c) => (
            <li key={c.checker_id} className="flex items-center justify-between gap-2 px-3 py-2">
              <div className="min-w-0">
                <p className="truncate font-semibold">{c.full_name || "—"}</p>
                <p className="truncate text-xs text-ink-600">{c.email}</p>
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
                className="btn btn-quiet-danger btn-sm shrink-0"
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
          className={inputClass}
        />
        <button disabled={pending} className="btn btn-primary shrink-0">
          Add
        </button>
      </form>
      {msg && <Notice kind={msg.ok ? "ok" : "error"}>{msg.text}</Notice>}
    </Card>
  );
}
