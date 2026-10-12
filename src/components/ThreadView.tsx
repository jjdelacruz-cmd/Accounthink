"use client";

import { useCallback, useEffect, useRef, useState, useTransition } from "react";
import { getThread, sendMessage } from "@/app/actions/messages";
import { Avatar } from "@/components/Avatar";
import { Notice } from "@/components/ui";
import type { Thread } from "@/lib/messages";
import { formatManila } from "@/lib/time";

const POLL_MS = 8000;

export function ThreadView({ initial }: { initial: Thread }) {
  const [thread, setThread] = useState(initial);
  const [text, setText] = useState("");
  const [error, setError] = useState<string>();
  const [pending, start] = useTransition();
  const bottom = useRef<HTMLDivElement>(null);
  const count = useRef(initial.messages.length);

  const refresh = useCallback(async () => {
    if (document.visibilityState === "hidden") return;
    const res = await getThread(initial.other.id).catch(() => null);
    if (res?.thread) setThread(res.thread);
  }, [initial.other.id]);

  useEffect(() => {
    const t = setInterval(refresh, POLL_MS);
    return () => clearInterval(t);
  }, [refresh]);

  // Scroll to the newest message when one arrives (and on first open).
  useEffect(() => {
    if (thread.messages.length !== count.current || count.current === initial.messages.length) {
      bottom.current?.scrollIntoView({ block: "end" });
    }
    count.current = thread.messages.length;
  }, [thread.messages.length, initial.messages.length]);

  const send = () => {
    const body = text.trim();
    if (!body) return;
    setError(undefined);
    start(async () => {
      const res = await sendMessage(thread.other.id, body);
      if (res.error) {
        setError(res.error);
        return;
      }
      setText("");
      await refresh();
    });
  };

  const { other } = thread;
  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-3">
        <Avatar name={other.full_name} src={other.avatar} size={48} />
        <div className="min-w-0">
          <h1 className="truncate text-lg font-bold">{other.full_name}</h1>
          <p className="text-xs capitalize text-slate-500">{other.role}</p>
        </div>
      </div>

      <div className="space-y-2" aria-live="polite">
        {thread.messages.length === 0 && <p className="py-6 text-center text-sm text-slate-500">No messages yet. Say hello below.</p>}
        {thread.messages.map((m) => (
          <div key={m.id} className={`flex ${m.mine ? "justify-end" : "justify-start"}`}>
            <div
              className={`max-w-[85%] rounded-2xl px-3 py-2 ${
                m.mine ? "rounded-br-md bg-emerald-700 text-white" : "rounded-bl-md border border-slate-200 bg-white"
              }`}
            >
              <p className="whitespace-pre-wrap break-words text-[15px]">{m.body}</p>
              <p className={`mt-0.5 text-[10px] ${m.mine ? "text-emerald-100" : "text-slate-400"}`}>{formatManila(m.created_at)}</p>
            </div>
          </div>
        ))}
        <div ref={bottom} />
      </div>

      {other.can_reply ? (
        <form
          className="sticky bottom-0 -mx-4 space-y-2 border-t border-slate-200 bg-slate-50/95 px-4 py-3 backdrop-blur"
          onSubmit={(e) => {
            e.preventDefault();
            send();
          }}
        >
          {error && <Notice kind="error">{error}</Notice>}
          <div className="flex items-end gap-2">
            <textarea
              value={text}
              onChange={(e) => setText(e.target.value)}
              rows={2}
              maxLength={2000}
              placeholder="Write a message"
              aria-label="Message"
              className="block w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-base outline-none focus:border-emerald-600"
            />
            <button
              disabled={pending || !text.trim()}
              className="min-h-12 shrink-0 rounded-xl bg-emerald-700 px-4 font-semibold text-white disabled:opacity-50"
            >
              {pending ? "…" : "Send"}
            </button>
          </div>
        </form>
      ) : (
        <p className="rounded-xl bg-slate-100 px-3 py-2 text-center text-sm text-slate-600">
          You can no longer message this person (they are not in one of your classes anymore).
        </p>
      )}
    </div>
  );
}
