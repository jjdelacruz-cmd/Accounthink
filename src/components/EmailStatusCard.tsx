"use client";

import { useState, useTransition } from "react";
import { sendTestEmail } from "@/app/actions/notify";
import { Card, Notice } from "@/components/ui";

export function EmailStatusCard({
  configured,
  missing,
  from,
  cronReady,
}: {
  configured: boolean;
  missing: string[];
  from: string | null;
  cronReady: boolean;
}) {
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<{ ok: boolean; text: string }>();
  return (
    <Card className="space-y-2">
      <h2 className="font-semibold">Email to students</h2>
      {configured ? (
        <p className="text-sm text-emerald-800">✓ Email is set up. Sending as {from}.</p>
      ) : (
        <div className="space-y-1 text-sm">
          <p className="text-amber-800">Email isn&apos;t set up yet, so students only see announcements and exams in the app.</p>
          <p className="text-slate-600">
            Missing in Netlify environment variables: <span className="font-mono">{missing.join(", ")}</span>. See the README
            (&ldquo;Email setup&rdquo;).
          </p>
        </div>
      )}
      <p className={`text-sm ${cronReady ? "text-emerald-800" : "text-slate-600"}`}>
        {cronReady
          ? "✓ Automatic 24-hour exam reminders are enabled (CRON_SECRET is set)."
          : "Automatic 24-hour reminders are off until CRON_SECRET is set (see the README)."}
      </p>
      {configured && (
        <button
          type="button"
          disabled={pending}
          onClick={() =>
            start(async () => {
              const r = await sendTestEmail();
              setMsg(r.error ? { ok: false, text: r.error } : { ok: true, text: r.message ?? "Sent." });
            })
          }
          className="min-h-11 rounded-xl border border-slate-300 bg-white px-4 text-sm font-semibold disabled:opacity-50"
        >
          {pending ? "Sending…" : "Send a test email to me"}
        </button>
      )}
      {msg && <Notice kind={msg.ok ? "ok" : "error"}>{msg.text}</Notice>}
    </Card>
  );
}
