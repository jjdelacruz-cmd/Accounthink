"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { deleteBatch } from "@/app/actions/items";
import { Notice } from "@/components/ui";

export type BatchRow = { id: string; label: string; source: string; created_at: string; count: number };

const when = (iso: string) =>
  new Intl.DateTimeFormat("en-PH", { timeZone: "Asia/Manila", month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" }).format(new Date(iso));

export function UploadsPanel({
  courseId,
  batches,
  individualCount,
  activeBatch,
}: {
  courseId: string;
  batches: BatchRow[];
  individualCount: number;
  activeBatch?: string;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [notice, setNotice] = useState<{ kind: "ok" | "error"; text: string }>();
  const base = `/instructor/courses/${courseId}/items`;

  const remove = (b: BatchRow) => {
    if (!confirm(`Delete the upload “${b.label}” and its ${b.count} question${b.count === 1 ? "" : "s"}? This can't be undone. Questions used in a published exam are kept.`)) return;
    setNotice(undefined);
    start(async () => {
      const res = await deleteBatch(courseId, b.id);
      if (res.error) setNotice({ kind: "error", text: res.error });
      else
        setNotice({
          kind: "ok",
          text: `Deleted ${res.deleted} question${res.deleted === 1 ? "" : "s"}${res.kept ? `; kept ${res.kept} used in a published exam (the upload stays for ${res.kept === 1 ? "it" : "them"})` : " and the upload"}.`,
        });
      if (activeBatch === b.id) router.push(base);
      else router.refresh();
    });
  };

  return (
    <details className="rounded-2xl border border-slate-200 bg-white shadow-sm" open={!!activeBatch}>
      <summary className="cursor-pointer px-4 py-3 font-semibold">
        Uploads <span className="font-normal text-slate-500">({batches.length})</span>
      </summary>
      <div className="space-y-2 px-4 pb-4">
        {notice && <Notice kind={notice.kind}>{notice.text}</Notice>}
        {batches.length === 0 && <p className="text-sm text-slate-500">No uploads yet. Use Import to add questions in bulk.</p>}
        <ul className="divide-y divide-slate-100 rounded-xl border border-slate-200">
          {batches.map((b) => (
            <li key={b.id} className={`flex flex-wrap items-center justify-between gap-2 p-3 ${activeBatch === b.id ? "bg-emerald-50" : ""}`}>
              <div className="min-w-0">
                <p className="truncate font-semibold">{b.label}</p>
                <p className="text-xs text-slate-500">
                  {b.count} question{b.count === 1 ? "" : "s"} · {b.source === "sheet" ? "Excel/CSV" : "Pasted"} · {when(b.created_at)}
                </p>
              </div>
              <div className="flex shrink-0 gap-2">
                <Link href={`${base}?batch=${b.id}`} className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm font-semibold">
                  Show
                </Link>
                <button
                  disabled={pending}
                  onClick={() => remove(b)}
                  className="rounded-lg px-3 py-1.5 text-sm font-semibold text-red-700 disabled:opacity-50"
                >
                  Delete upload
                </button>
              </div>
            </li>
          ))}
          <li className={`flex items-center justify-between gap-2 p-3 ${activeBatch === "none" ? "bg-emerald-50" : ""}`}>
            <div>
              <p className="font-semibold">Added individually / earlier imports</p>
              <p className="text-xs text-slate-500">{individualCount} question{individualCount === 1 ? "" : "s"}</p>
            </div>
            <Link href={`${base}?batch=none`} className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm font-semibold">
              Show
            </Link>
          </li>
        </ul>
      </div>
    </details>
  );
}
