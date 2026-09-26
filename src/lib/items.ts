export type ItemType = "mcq" | "identification" | "enumeration";
export type Difficulty = "easy" | "average" | "difficult";

export const ITEM_TYPE_LABEL: Record<ItemType, string> = {
  mcq: "Multiple choice",
  identification: "Identification",
  enumeration: "Enumeration",
};
export const DIFFICULTY_LABEL: Record<Difficulty, string> = {
  easy: "Easy",
  average: "Average",
  difficult: "Difficult",
};

export type Choice = { key: string; text: string };

export type McqAnswer = { correct: string };
export type IdentificationAnswer = { accepted: string[] };
export type EnumerationAnswer = { answers: string[][]; any_order: boolean };
export type Answer = McqAnswer | IdentificationAnswer | EnumerationAnswer;

/** What the item editor submits. */
export type ItemDraft = {
  id?: string;
  course_id: string;
  type: ItemType;
  stem: string;
  choices: Choice[] | null;
  topic: string;
  difficulty: Difficulty;
  points: number;
  explanation: string;
  answer: Answer;
};

export const CHOICE_KEYS = ["A", "B", "C", "D", "E", "F"];

/** Lowercase, trim, collapse spaces, drop trailing punctuation. Used for grading in Phase 3. */
export function normalizeAnswer(s: string): string {
  return s
    .normalize("NFKC")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim()
    .replace(/[.,;:!?]+$/, "");
}

const clean = (list: string[]) => {
  const seen = new Set<string>();
  return list
    .map((s) => s.trim())
    .filter((s) => s && !seen.has(normalizeAnswer(s)) && seen.add(normalizeAnswer(s)));
};

/** Validates and normalizes a draft. Returns an error message or the cleaned draft. */
export function validateItem(d: ItemDraft): { error: string } | { item: ItemDraft } {
  const stem = d.stem?.trim();
  if (!stem) return { error: "Write the question." };
  if (!["easy", "average", "difficult"].includes(d.difficulty)) return { error: "Pick a difficulty." };

  const base = {
    ...d,
    stem,
    topic: d.topic?.trim() ?? "",
    explanation: d.explanation?.trim() ?? "",
  };

  switch (d.type) {
    case "mcq": {
      const choices = (d.choices ?? [])
        .map((c) => ({ ...c, text: c.text.trim() }))
        .filter((c) => c.text);
      if (choices.length < 2) return { error: "Give at least 2 choices." };
      const texts = choices.map((c) => normalizeAnswer(c.text));
      if (new Set(texts).size !== texts.length) return { error: "Two choices are the same." };
      // Re-letter in order so keys are always A, B, C… with no gaps.
      const relettered = choices.map((c, i) => ({ key: CHOICE_KEYS[i], text: c.text, old: c.key }));
      const correct = relettered.find((c) => c.old === (d.answer as McqAnswer).correct);
      if (!correct) return { error: "Mark the correct choice." };
      const points = Number(d.points);
      if (!(points > 0)) return { error: "Points must be more than 0." };
      return {
        item: {
          ...base,
          points,
          choices: relettered.map(({ key, text }) => ({ key, text })),
          answer: { correct: correct.key },
        },
      };
    }
    case "identification": {
      const accepted = clean((d.answer as IdentificationAnswer).accepted ?? []);
      if (accepted.length === 0) return { error: "Give at least one accepted answer." };
      const points = Number(d.points);
      if (!(points > 0)) return { error: "Points must be more than 0." };
      return { item: { ...base, points, choices: null, answer: { accepted } } };
    }
    case "enumeration": {
      const a = d.answer as EnumerationAnswer;
      const answers = (a.answers ?? []).map(clean).filter((alts) => alts.length > 0);
      if (answers.length < 2) return { error: "An enumeration needs at least 2 answers." };
      // One point per expected answer.
      return {
        item: {
          ...base,
          points: answers.length,
          choices: null,
          answer: { answers, any_order: a.any_order !== false },
        },
      };
    }
    default:
      return { error: "Pick a question type." };
  }
}
