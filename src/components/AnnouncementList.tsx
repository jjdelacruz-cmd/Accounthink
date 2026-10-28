"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { deleteAnnouncement } from "@/app/actions/notify";
import { EmptyState, Notice } from "@/components/ui";
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
  if (items.length === 0)
    return (
      <EmptyState icon="megaphone" title="No announcements yet">
        Post one above and your students will see it on their dashboard.
      </EmptyState>
    );
  return (
    <div className="space-y-3">
      {err && <Notice kind="error">{err}</Notice>}
      {items.map((a) => (
        <div key={a.id} className="card space-y-1">
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
              className="btn btn-quiet-danger btn-sm -mr-2 -mt-1 shrink-0"
            >
              Delete
            </button>
          </div>
          <p className="whitespace-pre-line text-sm text-ink-700">{a.body}</p>
          <p className="text-xs text-ink-600">
            {formatManila(a.created_at)} · {a.audience}
            {a.emailed_at ? ` · emailed ${a.emailed_count ?? 0}` : " · not emailed"}
          </p>
        </div>
      ))}
    </div>
  );
}
