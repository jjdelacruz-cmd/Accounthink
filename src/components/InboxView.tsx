"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { Avatar } from "@/components/Avatar";
import { EmptyState, inputClass } from "@/components/ui";
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
        <ul className="card card-flush divide-y divide-ink-100">
          {inbox.map((m) => (
            <li key={m.other_id}>
              <Link href={`/messages/${m.other_id}`} className="flex min-h-16 items-center gap-3 px-3 py-3 hover:bg-ink-50">
                <Avatar name={m.full_name} src={m.avatar} size={44} />
                <div className="min-w-0 flex-1">
                  <div className="flex items-baseline justify-between gap-2">
                    <p className={`truncate ${m.unread > 0 ? "font-bold" : "font-semibold"}`}>{m.full_name}</p>
                    <p className="shrink-0 text-xs text-ink-600">{formatManila(m.last_at)}</p>
                  </div>
                  <p className={`truncate text-sm ${m.unread > 0 ? "font-semibold text-ink-900" : "text-ink-600"}`}>
                    {m.last_mine ? "You: " : ""}
                    {m.last_body}
                  </p>
                </div>
                {m.unread > 0 && (
                  <span className="flex h-5 min-w-5 shrink-0 items-center justify-center rounded-full bg-danger-600 px-1 text-[11px] font-bold text-white">
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
            className="btn btn-secondary w-full"
          >
            {open ? "Hide" : "＋ New message"}
          </button>
          {open && (
            <div className="card space-y-2 !p-3">
              {contacts.length > 6 && (
                <input
                  value={q}
                  onChange={(e) => setQ(e.target.value)}
                  placeholder="Search by name"
                  aria-label="Search people"
                  className={inputClass}
                />
              )}
              <ul className="divide-y divide-ink-100">
                {found.map((c) => (
                  <li key={c.id}>
                    <Link href={`/messages/${c.id}`} className="flex items-center gap-3 px-1 py-2.5">
                      <Avatar name={c.full_name} size={36} />
                      <span className="min-w-0">
                        <span className="block truncate font-semibold">{c.full_name}</span>
                        {c.detail && <span className="block truncate text-xs text-ink-600">{c.detail}</span>}
                      </span>
                    </Link>
                  </li>
                ))}
                {found.length === 0 && <li className="py-2 text-sm text-ink-600">No one matches.</li>}
              </ul>
            </div>
          )}
        </div>
      ) : (
        inbox.length === 0 && (
          <EmptyState icon="mail" title="Nobody to message yet">
            Join a class (students) or add students to a section (instructors) first.
          </EmptyState>
        )
      )}
    </div>
  );
}
