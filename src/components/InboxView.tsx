"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { Avatar } from "@/components/Avatar";
import type { Contact, InboxRow } from "@/lib/messages";
import { formatManila } from "@/lib/time";

export function InboxView({ inbox, contacts }: { inbox: InboxRow[]; contacts: Contact[] }) {
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(inbox.length === 0);
  const found = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return contacts.filter((c) => !needle || c.full_name.toLowerCase().includes(needle) || (c.detail ?? "").toLowerCase().includes(needle)).slice(0, 50);
  }, [contacts, q]);

  return (
    <div className="space-y-3">
      {inbox.length > 0 && (
        <ul className="divide-y divide-slate-100 overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
          {inbox.map((m) => (
            <li key={m.other_id}>
              <Link href={`/messages/${m.other_id}`} className="flex items-center gap-3 px-3 py-3 hover:bg-slate-50">
                <Avatar name={m.full_name} src={m.avatar} size={44} />
                <div className="min-w-0 flex-1">
                  <div className="flex items-baseline justify-between gap-2">
                    <p className={`truncate ${m.unread > 0 ? "font-bold" : "font-semibold"}`}>{m.full_name}</p>
                    <p className="shrink-0 text-xs text-slate-500">{formatManila(m.last_at)}</p>
                  </div>
                  <p className={`truncate text-sm ${m.unread > 0 ? "font-semibold text-slate-900" : "text-slate-600"}`}>
                    {m.last_mine ? "You: " : ""}
                    {m.last_body}
                  </p>
                </div>
                {m.unread > 0 && (
                  <span className="flex h-5 min-w-5 shrink-0 items-center justify-center rounded-full bg-red-600 px-1 text-[11px] font-bold text-white">
                    {m.unread}
                  </span>
                )}
              </Link>
            </li>
          ))}
        </ul>
      )}

      {contacts.length > 0 ? (
        <div className="space-y-2">
          <button
            type="button"
            onClick={() => setOpen(!open)}
            className="min-h-11 w-full rounded-xl border border-slate-300 bg-white px-4 text-sm font-semibold"
          >
            {open ? "Hide" : "＋ New message"}
          </button>
          {open && (
            <div className="space-y-2 rounded-2xl border border-slate-200 bg-white p-3 shadow-sm">
              {contacts.length > 6 && (
                <input
                  value={q}
                  onChange={(e) => setQ(e.target.value)}
                  placeholder="Search by name"
                  aria-label="Search people"
                  className="min-h-11 w-full rounded-xl border border-slate-300 px-3 text-base"
                />
              )}
              <ul className="divide-y divide-slate-100">
                {found.map((c) => (
                  <li key={c.id}>
                    <Link href={`/messages/${c.id}`} className="flex items-center gap-3 px-1 py-2.5">
                      <Avatar name={c.full_name} size={36} />
                      <span className="min-w-0">
                        <span className="block truncate font-semibold">{c.full_name}</span>
                        {c.detail && <span className="block truncate text-xs text-slate-500">{c.detail}</span>}
                      </span>
                    </Link>
                  </li>
                ))}
                {found.length === 0 && <li className="py-2 text-sm text-slate-500">No one matches.</li>}
              </ul>
            </div>
          )}
        </div>
      ) : (
        inbox.length === 0 && (
          <p className="text-sm text-slate-600">
            Nobody to message yet. Join a class (students) or add students to a section (instructors) first.
          </p>
        )
      )}
    </div>
  );
}
