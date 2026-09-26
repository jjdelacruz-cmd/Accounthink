"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { saveItem } from "@/app/actions/items";
import { Button, Notice } from "@/components/ui";
import {
  CHOICE_KEYS,
  DIFFICULTY_LABEL,
  ITEM_TYPE_LABEL,
  type Choice,
  type Difficulty,
  type EnumerationAnswer,
  type IdentificationAnswer,
  type ItemDraft,
  type ItemType,
  type McqAnswer,
} from "@/lib/items";

const input =
  "block w-full rounded-xl border border-slate-300 bg-white px-3 py-3 text-base outline-none focus:border-emerald-600 focus:ring-2 focus:ring-emerald-600/20";
const label = "mb-1 block text-sm font-medium text-slate-700";

export function ItemEditor({ courseId, initial, topics }: { courseId: string; initial?: ItemDraft; topics: string[] }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string>();
  const [saved, setSaved] = useState(false);

  const [type, setType] = useState<ItemType>(initial?.type ?? "mcq");
  const [stem, setStem] = useState(initial?.stem ?? "");
  const [topic, setTopic] = useState(initial?.topic ?? "");
  const [difficulty, setDifficulty] = useState<Difficulty>(initial?.difficulty ?? "average");
  const [points, setPoints] = useState(String(initial?.points ?? 1));
  const [explanation, setExplanation] = useState(initial?.explanation ?? "");

  // MC
  const [choices, setChoices] = useState<Choice[]>(
    initial?.type === "mcq" && initial.choices
      ? initial.choices
      : CHOICE_KEYS.slice(0, 4).map((key) => ({ key, text: "" })),
  );
  const [correct, setCorrect] = useState(initial?.type === "mcq" ? (initial.answer as McqAnswer).correct : "");

  // Identification: one accepted answer per line
  const [accepted, setAccepted] = useState(
    initial?.type === "identification" ? (initial.answer as IdentificationAnswer).accepted.join("\n") : "",
  );

  // Enumeration: one row per expected answer; alternates separated by " / "
  const [enumRows, setEnumRows] = useState<string[]>(
    initial?.type === "enumeration"
      ? (initial.answer as EnumerationAnswer).answers.map((alts) => alts.join(" / "))
      : ["", ""],
  );
  const [anyOrder, setAnyOrder] = useState(
    initial?.type === "enumeration" ? (initial.answer as EnumerationAnswer).any_order : true,
  );

  function buildDraft(): ItemDraft {
    const base = {
      id: initial?.id,
      course_id: courseId,
      type,
      stem,
      topic,
      difficulty,
      points: Number(points),
      explanation,
    };
    if (type === "mcq") return { ...base, choices, answer: { correct } };
    if (type === "identification")
      return { ...base, choices: null, answer: { accepted: accepted.split("\n") } };
    return {
      ...base,
      choices: null,
      answer: { answers: enumRows.map((r) => r.split("/")), any_order: anyOrder },
    };
  }

  function submit(andNew: boolean) {
    setError(undefined);
    setSaved(false);
    start(async () => {
      const res = await saveItem(buildDraft());
      if (res.error) {
        setError(res.error);
        return;
      }
      if (andNew) {
        // Keep type/topic/difficulty for fast entry of similar items.
        setStem("");
        setExplanation("");
        setChoices(CHOICE_KEYS.slice(0, 4).map((key) => ({ key, text: "" })));
        setCorrect("");
        setAccepted("");
        setEnumRows(["", ""]);
        setSaved(true);
        window.scrollTo({ top: 0, behavior: "smooth" });
        router.refresh();
      } else {
        router.push(`/instructor/courses/${courseId}/items`);
      }
    });
  }

  return (
    <div className="space-y-4">
      {saved && <Notice kind="ok">Saved. Enter the next item.</Notice>}

      <div>
        <span className={label}>Type</span>
        <div className="grid grid-cols-3 gap-1 rounded-xl bg-slate-200/70 p-1">
          {(Object.keys(ITEM_TYPE_LABEL) as ItemType[]).map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => setType(t)}
              className={`rounded-lg px-2 py-2 text-sm font-semibold ${
                type === t ? "bg-white text-emerald-800 shadow-sm" : "text-slate-600"
              }`}
            >
              {ITEM_TYPE_LABEL[t]}
            </button>
          ))}
        </div>
      </div>

      <label className="block">
        <span className={label}>Question</span>
        <textarea value={stem} onChange={(e) => setStem(e.target.value)} rows={4} className={input} />
      </label>

      {type === "mcq" && (
        <fieldset className="space-y-2">
          <legend className={label}>Choices — tap the circle beside the correct answer</legend>
          {choices.map((c, i) => (
            <div key={c.key} className="flex items-center gap-2">
              <input
                type="radio"
                name="correct"
                aria-label={`Choice ${c.key} is correct`}
                checked={correct === c.key}
                onChange={() => setCorrect(c.key)}
                className="h-6 w-6 shrink-0 accent-emerald-700"
              />
              <span className="w-5 shrink-0 font-semibold">{CHOICE_KEYS[i]}.</span>
              <input
                value={c.text}
                onChange={(e) =>
                  setChoices(choices.map((x) => (x.key === c.key ? { ...x, text: e.target.value } : x)))
                }
                className={input}
              />
              {choices.length > 2 && (
                <button
                  type="button"
                  aria-label={`Remove choice ${CHOICE_KEYS[i]}`}
                  onClick={() => {
                    setChoices(choices.filter((x) => x.key !== c.key));
                    if (correct === c.key) setCorrect("");
                  }}
                  className="shrink-0 rounded-lg px-2 py-2 text-slate-500"
                >
                  ✕
                </button>
              )}
            </div>
          ))}
          {choices.length < CHOICE_KEYS.length && (
            <button
              type="button"
              onClick={() => {
                // Internal keys only need to be unique; they are re-lettered on save.
                const used = new Set(choices.map((c) => c.key));
                const key = CHOICE_KEYS.find((k) => !used.has(k)) ?? `X${choices.length}`;
                setChoices([...choices, { key, text: "" }]);
              }}
              className="text-sm font-semibold text-emerald-700"
            >
              + Add choice
            </button>
          )}
        </fieldset>
      )}

      {type === "identification" && (
        <label className="block">
          <span className={label}>Accepted answers — one per line (not case-sensitive)</span>
          <textarea
            value={accepted}
            onChange={(e) => setAccepted(e.target.value)}
            rows={3}
            placeholder={"Going concern\nGoing concern assumption"}
            className={input}
          />
        </label>
      )}

      {type === "enumeration" && (
        <fieldset className="space-y-2">
          <legend className={label}>
            Expected answers — one per box. Separate alternate wordings with “/”. 1 point each.
          </legend>
          {enumRows.map((row, i) => (
            <div key={i} className="flex items-center gap-2">
              <span className="w-6 shrink-0 text-right font-semibold">{i + 1}.</span>
              <input
                value={row}
                onChange={(e) => setEnumRows(enumRows.map((r, j) => (j === i ? e.target.value : r)))}
                placeholder={i === 0 ? "Cash / Cash on hand" : ""}
                className={input}
              />
              {enumRows.length > 2 && (
                <button
                  type="button"
                  aria-label={`Remove answer ${i + 1}`}
                  onClick={() => setEnumRows(enumRows.filter((_, j) => j !== i))}
                  className="shrink-0 rounded-lg px-2 py-2 text-slate-500"
                >
                  ✕
                </button>
              )}
            </div>
          ))}
          <button
            type="button"
            onClick={() => setEnumRows([...enumRows, ""])}
            className="text-sm font-semibold text-emerald-700"
          >
            + Add answer
          </button>
          <label className="flex items-center gap-2 pt-1 text-sm">
            <input
              type="checkbox"
              checked={anyOrder}
              onChange={(e) => setAnyOrder(e.target.checked)}
              className="h-5 w-5 accent-emerald-700"
            />
            Any order is correct
          </label>
        </fieldset>
      )}

      <div className="grid grid-cols-2 gap-3">
        <label className="col-span-2 block">
          <span className={label}>Topic</span>
          <input
            value={topic}
            onChange={(e) => setTopic(e.target.value)}
            list="topics"
            placeholder="e.g. Audit evidence"
            className={input}
          />
          <datalist id="topics">
            {topics.map((t) => (
              <option key={t} value={t} />
            ))}
          </datalist>
        </label>
        <label className="block">
          <span className={label}>Difficulty</span>
          <select
            value={difficulty}
            onChange={(e) => setDifficulty(e.target.value as Difficulty)}
            className={input}
          >
            {(Object.keys(DIFFICULTY_LABEL) as Difficulty[]).map((d) => (
              <option key={d} value={d}>{DIFFICULTY_LABEL[d]}</option>
            ))}
          </select>
        </label>
        <label className="block">
          <span className={label}>Points</span>
          {type === "enumeration" ? (
            <input value={enumRows.filter((r) => r.trim()).length} disabled className={`${input} bg-slate-100`} />
          ) : (
            <input
              type="number"
              inputMode="decimal"
              min="0.5"
              step="0.5"
              value={points}
              onChange={(e) => setPoints(e.target.value)}
              className={input}
            />
          )}
        </label>
      </div>

      <label className="block">
        <span className={label}>Explanation (optional, shown in results later)</span>
        <textarea value={explanation} onChange={(e) => setExplanation(e.target.value)} rows={2} className={input} />
      </label>

      {error && <Notice kind="error">{error}</Notice>}

      <div className="flex flex-col gap-2 sm:flex-row">
        <Button type="button" disabled={pending} onClick={() => submit(false)} className="sm:flex-1">
          {pending ? "Saving…" : "Save"}
        </Button>
        {!initial?.id && (
          <Button type="button" variant="secondary" disabled={pending} onClick={() => submit(true)} className="sm:flex-1">
            Save and add another
          </Button>
        )}
      </div>
    </div>
  );
}
