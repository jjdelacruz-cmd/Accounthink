"use client";

import { useRouter } from "next/navigation";
import { useMemo, useState, useTransition } from "react";
import { addExamItems } from "@/app/actions/exams";
import { Button, Notice } from "@/components/ui";
import { DIFFICULTY_LABEL, ITEM_TYPE_LABEL, type Difficulty, type ItemType } from "@/lib/items";

export type PickerItem = {
  id: string;
  type: ItemType;
  stem: string;
  topic: string | null;
  difficulty: Difficulty;
  points: number;
  batch_id: string | null;
  batch_label: string | null;
};

const sel = "rounded-xl border border-slate-300 bg-white px-2 py-2 text-sm";

export function ExamItemPicker({ examId, courseId, items }: { examId: string; courseId: string; items: PickerItem[] }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string>();
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [q, setQ] = useState("");
  const [type, setType] = useState("");
  const [topic, setTopic] = useState("");
  const [difficulty, setDifficulty] = useState("");
  const [batch, setBatch] = useState("");

  const topics = useMemo(
    () => [...new Set(items.map((i) => i.topic).filter((t): t is string => !!t))].sort(),
    [items],
  );
  const uploads = useMemo(() => {
    const m = new Map<string, [string, string, number]>();
    for (const i of items) {
      if (!i.batch_id) continue;
      const cur = m.get(i.batch_id);
      m.set(i.batch_id, [i.batch_id, i.batch_label ?? "Upload", (cur?.[2] ?? 0) + 1]);
    }
    return [...m.values()];
  }, [items]);
  const shown = items.filter(
    (i) =>
      (!type || i.type === type) &&
      (!topic || i.topic === topic) &&
      (!difficulty || i.difficulty === difficulty) &&
      (!batch || (batch === "none" ? !i.batch_id : i.batch_id === batch)) &&
      (!q || i.stem.toLowerCase().includes(q.toLowerCase())),
  );

  const toggle = (id: string) => {
    const next = new Set(picked);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setPicked(next);
  };

  if (items.length === 0) {
    return <p className="text-sm text-slate-500">Every active item in the bank is already in this exam.</p>;
  }

  return (
    <div className="space-y-3">
      {uploads.length > 0 && (
        <select value={batch} onChange={(e) => setBatch(e.target.value)} className={`${sel} w-full`} aria-label="Upload">
          <option value="">All uploads</option>
          {uploads.map(([id, label, n]) => (
            <option key={id} value={id}>
              ⬆ {label} ({n})
            </option>
          ))}
          {items.some((i) => !i.batch_id) && <option value="none">Added individually / earlier imports</option>}
        </select>
      )}
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search"
          className={`${sel} col-span-2 sm:col-span-1`}
        />
        <select value={type} onChange={(e) => setType(e.target.value)} className={sel}>
          <option value="">All types</option>
          {Object.entries(ITEM_TYPE_LABEL).map(([v, l]) => (
            <option key={v} value={v}>{l}</option>
          ))}
        </select>
        <select value={difficulty} onChange={(e) => setDifficulty(e.target.value)} className={sel}>
          <option value="">All levels</option>
          {Object.entries(DIFFICULTY_LABEL).map(([v, l]) => (
            <option key={v} value={v}>{l}</option>
          ))}
        </select>
        <select value={topic} onChange={(e) => setTopic(e.target.value)} className={`${sel} col-span-2 sm:col-span-1`}>
          <option value="">All topics</option>
          {topics.map((t) => (
            <option key={t} value={t}>{t}</option>
          ))}
        </select>
      </div>

      <div className="flex items-center justify-between text-sm">
        <span className="text-slate-600">{shown.length} shown</span>
        <button
          type="button"
          onClick={() => setPicked(new Set([...picked, ...shown.map((i) => i.id)]))}
          className="font-semibold text-emerald-700"
        >
          Select all shown
        </button>
      </div>

      <ul className="max-h-[60vh] divide-y divide-slate-100 overflow-y-auto rounded-xl border border-slate-200">
        {shown.map((i) => (
          <li key={i.id}>
            <label className="flex cursor-pointer items-start gap-3 p-3">
              <input
                type="checkbox"
                checked={picked.has(i.id)}
                onChange={() => toggle(i.id)}
                className="mt-0.5 h-5 w-5 shrink-0 accent-emerald-700"
              />
              <span className="min-w-0">
                <span className="line-clamp-2 text-sm">{i.stem}</span>
                <span className="block text-xs text-slate-500">
                  {ITEM_TYPE_LABEL[i.type]} · {DIFFICULTY_LABEL[i.difficulty]} · {Number(i.points)} pt
                  {i.topic ? ` · ${i.topic}` : ""}
                </span>
              </span>
            </label>
          </li>
        ))}
      </ul>

      {error && <Notice kind="error">{error}</Notice>}
      <Button
        type="button"
        disabled={pending || picked.size === 0}
        className="sticky bottom-3 w-full shadow-lg"
        onClick={() =>
          start(async () => {
            setError(undefined);
            const res = await addExamItems(examId, courseId, [...picked]);
            if (res.error) setError(res.error);
            else {
              setPicked(new Set());
              router.refresh();
            }
          })
        }
      >
        {pending ? "Adding…" : `Add ${picked.size || ""} selected`}
      </Button>
    </div>
  );
}
