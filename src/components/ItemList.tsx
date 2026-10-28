"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { deleteItems, setItemsArchived } from "@/app/actions/items";
import { DuplicateItemButton } from "@/components/DuplicateItemButton";
import { Icon } from "@/components/icons";
import { Badge, Notice } from "@/components/ui";
import {
  DIFFICULTY_LABEL,
  ITEM_TYPE_LABEL,
  type Answer,
  type Choice,
  type Difficulty,
  type EnumerationAnswer,
  type EssayAnswer,
  type IdentificationAnswer,
  type ItemType,
  type McqAnswer,
} from "@/lib/items";

export type ItemRow = {
  id: string;
  type: ItemType;
  stem: string;
  choices: Choice[] | null;
  topic: string | null;
  difficulty: Difficulty;
  points: number;
  archived: boolean;
  batch_label: string | null;
  answer: Answer | null;
};

function answerPreview(r: ItemRow): string {
  const a = r.answer;
  if (!a) return "No key";
  if (r.type === "mcq") {
    const key = (a as McqAnswer).correct;
    return `${key}. ${r.choices?.find((c) => c.key === key)?.text ?? ""}`;
  }
  if (r.type === "identification") return (a as IdentificationAnswer).accepted.join(" / ");
  if (r.type === "essay") return (a as EssayAnswer).guide ? `Checked by hand · guide: ${(a as EssayAnswer).guide}` : "Checked by hand";
  return (a as EnumerationAnswer).answers.map((alts) => alts[0]).join(", ");
}

function summary(deleted = 0, kept = 0) {
  const parts = [`Deleted ${deleted} question${deleted === 1 ? "" : "s"}.`];
  if (kept)
    parts.push(
      `${kept} ${kept === 1 ? "is" : "are"} used in a published or closed exam and ${kept === 1 ? "was" : "were"} kept. Archive ${kept === 1 ? "it" : "them"} instead to hide from the bank.`,
    );
  return parts.join(" ");
}

export function ItemList({ courseId, items, archivedView }: { courseId: string; items: ItemRow[]; archivedView: boolean }) {
  const router = useRouter();
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [pending, start] = useTransition();
  const [notice, setNotice] = useState<{ kind: "ok" | "error"; text: string }>();
  // Hidden right away after a successful archive/restore, or after a delete with nothing kept,
  // so the list doesn't show them while the page refreshes.
  const [gone, setGone] = useState<Set<string>>(new Set());
  const visible = items.filter((i) => !gone.has(i.id));

  const toggle = (id: string) => {
    const next = new Set(picked);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setPicked(next);
  };
  const allPicked = visible.length > 0 && visible.every((i) => picked.has(i.id));

  const run = (ids: string[], what: "delete" | "archive" | "restore") => {
    const n = ids.length;
    const noun = `${n} question${n === 1 ? "" : "s"}`;
    const ask =
      what === "delete"
        ? `Delete ${noun}? This can't be undone. Questions used in a published exam are kept.`
        : what === "archive"
          ? `Archive ${noun}? They'll be hidden from the bank and exam builder, but kept.`
          : `Restore ${noun} to the active bank?`;
    if (!confirm(ask)) return;
    setNotice(undefined);
    start(async () => {
      if (what === "delete") {
        const res = await deleteItems(courseId, ids);
        if (res.error) setNotice({ kind: "error", text: res.error });
        else {
          if (!res.kept) setGone((g) => new Set([...g, ...ids]));
          setNotice({ kind: "ok", text: summary(res.deleted, res.kept) });
        }
      } else {
        const res = await setItemsArchived(courseId, ids, what === "archive");
        if (res.error) setNotice({ kind: "error", text: res.error });
        else {
          setGone((g) => new Set([...g, ...ids]));
          setNotice({ kind: "ok", text: `${what === "archive" ? "Archived" : "Restored"} ${res.count} question${res.count === 1 ? "" : "s"}.` });
        }
      }
      setPicked(new Set());
      router.refresh();
    });
  };

  return (
    <div className="space-y-3 pb-20">
      {notice && <Notice kind={notice.kind}>{notice.text}</Notice>}

      {visible.length > 0 && (
        <label className="flex min-h-10 items-center gap-2 text-sm font-medium">
          <input
            type="checkbox"
            checked={allPicked}
            onChange={() => setPicked(allPicked ? new Set() : new Set(visible.map((i) => i.id)))}
          />
          Select all shown ({visible.length})
        </label>
      )}

      {visible.map((r) => (
        <div
          key={r.id}
          className={`card space-y-2 ${picked.has(r.id) ? "!border-brand-500 ring-1 ring-brand-500" : ""}`}
        >
          <div className="flex items-start gap-3">
            <input
              type="checkbox"
              aria-label="Select question"
              checked={picked.has(r.id)}
              onChange={() => toggle(r.id)}
              className="mt-0.5 shrink-0"
            />
            <div className="min-w-0 flex-1 space-y-2">
              <div className="flex flex-wrap gap-1">
                <Badge tone="brand">{ITEM_TYPE_LABEL[r.type]}</Badge>
                <Badge>{DIFFICULTY_LABEL[r.difficulty]}</Badge>
                <Badge>
                  {Number(r.points)} pt{Number(r.points) === 1 ? "" : "s"}
                </Badge>
                {r.topic && <Badge tone="warning">{r.topic}</Badge>}
                <Badge tone="info">
                  {r.batch_label && <Icon name="upload" size={12} />}
                  {r.batch_label ? r.batch_label : "Added individually"}
                </Badge>
              </div>
              <p className="line-clamp-3 whitespace-pre-line text-ink-900">{r.stem}</p>
              <p className="text-sm text-ink-600">
                <span className="font-semibold text-ink-800">Answer:</span> {answerPreview(r)}
              </p>
            </div>
          </div>
          <div className="flex flex-wrap gap-2 border-t border-ink-100 pt-3 pl-8">
            <Link
              href={`/instructor/courses/${courseId}/items/${r.id}`}
              className="btn btn-secondary btn-sm"
            >
              Edit
            </Link>
            <DuplicateItemButton itemId={r.id} courseId={courseId} />
            <button
              disabled={pending}
              onClick={() => run([r.id], r.archived ? "restore" : "archive")}
              className="btn btn-quiet btn-sm"
            >
              {r.archived ? "Restore" : "Archive"}
            </button>
            <button
              disabled={pending}
              onClick={() => run([r.id], "delete")}
              className="btn btn-quiet-danger btn-sm"
            >
              Delete
            </button>
          </div>
        </div>
      ))}

      {picked.size > 0 && (
        <div className="fixed inset-x-0 bottom-0 z-20 border-t border-ink-200 bg-white shadow-pop">
          <div className="mx-auto flex max-w-3xl items-center gap-2 px-4 py-3">
            <span className="flex-1 text-sm font-semibold">{picked.size} selected</span>
            <button
              disabled={pending}
              onClick={() => run([...picked], archivedView ? "restore" : "archive")}
              className="btn btn-secondary btn-sm"
            >
              {archivedView ? "Restore" : "Archive"}
            </button>
            <button
              disabled={pending}
              onClick={() => run([...picked], "delete")}
              className="btn btn-danger btn-sm"
            >
              {pending ? "Working…" : "Delete"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
