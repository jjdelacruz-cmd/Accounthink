"use client";

import { useEffect, useRef } from "react";
import { useActionState } from "react";
import { postAnnouncement } from "@/app/actions/notify";
import { Button, Card, Notice } from "@/components/ui";
import { useKeepFormValues } from "@/lib/useKeepFormValues";

const input =
  "block w-full rounded-xl border border-slate-300 bg-white px-3 py-3 text-base outline-none focus:border-emerald-600 focus:ring-2 focus:ring-emerald-600/20";

export function AnnouncementForm({
  courseId,
  sections,
  emailReady,
}: {
  courseId: string;
  sections: { id: string; name: string }[];
  emailReady: boolean;
}) {
  const [state, action, pending] = useActionState(postAnnouncement, undefined);
  const ref = useRef<HTMLFormElement>(null);
  const { remember, restore } = useKeepFormValues(ref);
  useEffect(() => {
    if (state?.error) restore(); // keep what was typed when something is wrong
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state]);

  return (
    <Card>
      <h2 className="mb-3 font-semibold">New announcement</h2>
      <form ref={ref} action={action} onSubmit={remember} className="space-y-3">
        <input type="hidden" name="course_id" value={courseId} />
        <label className="block">
          <span className="mb-1 block text-sm font-medium text-slate-700">Title</span>
          <input name="title" maxLength={150} required placeholder="e.g. Quiz on Friday" className={input} />
        </label>
        <label className="block">
          <span className="mb-1 block text-sm font-medium text-slate-700">Message</span>
          <textarea name="body" rows={4} maxLength={5000} required className={input} />
        </label>
        {sections.length > 1 && (
          <fieldset>
            <legend className="mb-1 text-sm font-medium text-slate-700">Send to</legend>
            <p className="mb-1 text-xs text-slate-500">Tick sections to limit it. Leave all unticked for every section.</p>
            <div className="grid grid-cols-2 gap-2">
              {sections.map((s) => (
                <label key={s.id} className="flex items-center gap-2 rounded-xl border border-slate-200 px-3 py-3">
                  <input type="checkbox" name="section_ids" value={s.id} className="h-5 w-5 accent-emerald-700" />
                  <span className="font-medium">{s.name}</span>
                </label>
              ))}
            </div>
          </fieldset>
        )}
        <label className="flex items-start gap-2 text-sm">
          <input type="checkbox" name="send_email" defaultChecked={emailReady} className="mt-0.5 h-5 w-5 accent-emerald-700" />
          <span>
            Also email the students
            {!emailReady && <span className="block text-xs text-amber-700">Email isn&apos;t set up yet; students will see it in the app only.</span>}
          </span>
        </label>
        {state?.error && <Notice kind="error">{state.error}</Notice>}
        {state?.message && <Notice kind="ok">{state.message}</Notice>}
        <Button type="submit" disabled={pending} className="w-full">
          {pending ? "Posting…" : "Post announcement"}
        </Button>
      </form>
    </Card>
  );
}
