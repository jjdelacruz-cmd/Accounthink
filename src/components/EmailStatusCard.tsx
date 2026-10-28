"use client";

import { useState, useTransition } from "react";
import { sendTestEmail } from "@/app/actions/notify";
import { Icon } from "@/components/icons";
import { Card, Notice, SectionTitle } from "@/components/ui";

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
      <SectionTitle>Email to students</SectionTitle>
      {configured ? (
        <p className="flex items-start gap-1.5 text-sm text-brand-800">
          <Icon name="check" size={16} className="mt-1" />
          <span>Email is set up. Sending as {from}.</span>
        </p>
      ) : (
        <div className="space-y-1 text-sm">
          <p className="text-warning-800">Email isn&apos;t set up yet, so students only see announcements and exams in the app.</p>
          <p className="text-ink-600">
            Missing in Netlify environment variables: <span className="font-mono">{missing.join(", ")}</span>. See the README
            (&ldquo;Email setup&rdquo;).
          </p>
        </div>
      )}
      <p className={`flex items-start gap-1.5 text-sm ${cronReady ? "text-brand-800" : "text-ink-600"}`}>
        {cronReady && <Icon name="check" size={16} className="mt-1" />}
        <span>
          {cronReady
            ? "Automatic 24-hour exam reminders are enabled (CRON_SECRET is set)."
            : "Automatic 24-hour reminders are off until CRON_SECRET is set (see the README)."}
        </span>
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
          className="btn btn-secondary btn-sm"
        >
          {pending ? "Sending…" : "Send a test email to me"}
        </button>
      )}
      {msg && <Notice kind={msg.ok ? "ok" : "error"}>{msg.text}</Notice>}
    </Card>
  );
}
