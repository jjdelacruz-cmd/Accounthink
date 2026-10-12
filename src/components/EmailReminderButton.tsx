"use client";

import { useState, useTransition } from "react";
import { sendExamReminder } from "@/app/actions/notify";
import { Notice } from "@/components/ui";

export function EmailReminderButton({ courseId, examId }: { courseId: string; examId: string }) {
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<{ ok: boolean; text: string }>();
  return (
    <div className="space-y-2">
      <button
        type="button"
        disabled={pending}
        onClick={() => {
          if (!confirm("Email the students in this exam's sections about it now?")) return;
          start(async () => {
            const r = await sendExamReminder(courseId, examId);
            setMsg(r.error ? { ok: false, text: r.error } : { ok: true, text: r.message ?? "Sent." });
          });
        }}
        className="min-h-11 w-full rounded-xl border border-slate-300 bg-white px-4 text-sm font-semibold disabled:opacity-50"
      >
        {pending ? "Sending…" : "✉ Email students about this exam now"}
      </button>
      {msg && <Notice kind={msg.ok ? "ok" : "error"}>{msg.text}</Notice>}
    </div>
  );
}
