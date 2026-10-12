"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { deleteAnnouncement } from "@/app/actions/notify";
import { Notice } from "@/components/ui";
import { formatManila } from "@/lib/time";

export type AnnouncementRow = {
  id: string;
  title: string;
  body: string;
  audience: string;
  created_at: string;
  emailed_at: string | null;
  emailed_count: number | null;
};

export function AnnouncementList({ courseId, items }: { courseId: string; items: AnnouncementRow[] }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [err, setErr] = useState<string>();
  if (items.length === 0) return <p className="text-sm text-slate-600">No announcements yet.</p>;
  return (
    <div className="space-y-2">
      {err && <Notice kind="error">{err}</Notice>}
      {items.map((a) => (
        <div key={a.id} className="space-y-1 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
          <div className="flex items-start justify-between gap-2">
            <p className="font-semibold">{a.title}</p>
            <button
              type="button"
              disabled={pending}
              onClick={() => {
                if (!confirm("Delete this announcement? Students will no longer see it.")) return;
                start(async () => {
                  const r = await deleteAnnouncement(courseId, a.id);
                  setErr(r.error);
                  router.refresh();
                });
              }}
              className="shrink-0 text-sm font-semibold text-red-700 disabled:opacity-50"
            >
              Delete
            </button>
          </div>
          <p className="whitespace-pre-line text-sm text-slate-700">{a.body}</p>
          <p className="text-xs text-slate-500">
            {formatManila(a.created_at)} · {a.audience}
            {a.emailed_at ? ` · emailed ${a.emailed_count ?? 0}` : " · not emailed"}
          </p>
        </div>
      ))}
    </div>
  );
}
