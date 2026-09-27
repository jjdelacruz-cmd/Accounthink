// Bulk import: turns pasted Word text or spreadsheet rows into item drafts.
// Every draft is then checked with validateItem(), the same rules as the editor.
import {
  CHOICE_KEYS,
  normalizeAnswer,
  validateItem,
  type Answer,
  type Choice,
  type Difficulty,
  type ItemDraft,
  type ItemType,
} from "@/lib/items";

export type ParsedItem = {
  /** "Item 3" / "Row 12" — where it came from, for error messages. */
  source: string;
  draft?: ItemDraft;
  error?: string;
  duplicate?: boolean;
};

export type ImportDefaults = { topic: string; difficulty: Difficulty };

const DIFFICULTY_ALIASES: Record<string, Difficulty> = {
  easy: "easy",
  e: "easy",
  average: "average",
  avg: "average",
  a: "average",
  medium: "average",
  moderate: "average",
  m: "average",
  difficult: "difficult",
  d: "difficult",
  hard: "difficult",
  h: "difficult",
};

function parseDifficulty(v: string | undefined, fallback: Difficulty): Difficulty | null {
  const key = (v ?? "").trim().toLowerCase();
  if (!key) return fallback;
  return DIFFICULTY_ALIASES[key] ?? null;
}

const splitAlternates = (s: string) =>
  s
    .split(/\s*[/|]\s*/)
    .map((x) => x.trim())
    .filter(Boolean);

/**
 * Builds a draft from loose pieces. Type is taken from `typeHint` or inferred:
 * choices → multiple choice; answer with ";" → enumeration; else identification.
 */
function buildDraft(
  courseId: string,
  defaults: ImportDefaults,
  p: {
    typeHint?: string;
    stem: string;
    choices: string[];
    markedCorrect?: number; // index of a choice marked with *
    answer: string;
    topic?: string;
    difficulty?: string;
    points?: string;
  },
): { draft?: ItemDraft; error?: string } {
  const hint = (p.typeHint ?? "").trim().toLowerCase();
  const choices = p.choices.map((c) => c.trim()).filter(Boolean);
  let answerText = p.answer.trim();
  let anyOrder = true;
  const inOrder = /^\(?in order\)?\s*[:：-]?\s*/i;
  if (inOrder.test(answerText)) {
    anyOrder = false;
    answerText = answerText.replace(inOrder, "");
  }

  let type: ItemType;
  if (["mcq", "mc", "multiple choice", "multiple-choice"].includes(hint)) type = "mcq";
  else if (["identification", "id", "ident", "fill in the blank"].includes(hint)) type = "identification";
  else if (["enumeration", "enum", "en"].includes(hint)) type = "enumeration";
  else if (hint) return { error: `Unknown type "${p.typeHint}". Use MCQ, Identification or Enumeration.` };
  else if (choices.length > 0) type = "mcq";
  else if (answerText.includes(";")) type = "enumeration";
  else type = "identification";

  const difficulty = parseDifficulty(p.difficulty, defaults.difficulty);
  if (!difficulty) return { error: `Unknown difficulty "${p.difficulty}". Use Easy, Average or Difficult.` };

  const pointsText = (p.points ?? "").trim();
  const points = pointsText ? Number(pointsText) : 1;
  if (pointsText && !(points > 0)) return { error: `Points "${p.points}" is not a positive number.` };

  let answer: Answer;
  let itemChoices: Choice[] | null = null;
  if (type === "mcq") {
    itemChoices = choices.map((text, i) => ({ key: CHOICE_KEYS[i] ?? `X${i}`, text }));
    if (choices.length > CHOICE_KEYS.length) return { error: `Too many choices (max ${CHOICE_KEYS.length}).` };
    let correct: string | undefined;
    if (p.markedCorrect !== undefined) correct = CHOICE_KEYS[p.markedCorrect];
    if (answerText) {
      const letter = answerText.match(/^\(?([A-Fa-f])\)?\.?$/)?.[1]?.toUpperCase();
      // Also accept the answer written out in full, e.g. "ANSWER: Cash".
      const byText = itemChoices.find((c) => normalizeAnswer(c.text) === normalizeAnswer(answerText))?.key;
      correct = letter ?? byText;
      if (!correct) return { error: `Answer "${answerText}" doesn't match any choice letter.` };
    }
    if (!correct) return { error: "No answer. Add ANSWER: B, or put * before the correct choice." };
    answer = { correct };
  } else if (type === "identification") {
    if (!answerText) return { error: "No answer. Add an ANSWER: line." };
    answer = { accepted: splitAlternates(answerText) };
  } else {
    if (!answerText) return { error: "No answers. Add ANSWER: first; second; third" };
    answer = {
      answers: answerText
        .split(/\s*;\s*/)
        .filter(Boolean)
        .map(splitAlternates),
      any_order: anyOrder,
    };
  }

  const result = validateItem({
    course_id: courseId,
    type,
    stem: p.stem,
    choices: itemChoices,
    topic: (p.topic ?? "").trim() || defaults.topic,
    difficulty,
    points,
    explanation: "",
    answer,
  });
  return "error" in result ? { error: result.error } : { draft: result.item };
}

// ---------------------------------------------------------------------------
// Text format (pasted from Word)
// ---------------------------------------------------------------------------
//   1. Which is an asset?
//   A. Revenue
//   B. Cash
//   ANSWER: B
//
//   2. The assumption that the entity will continue operating.
//   ANSWER: Going concern / Going concern assumption
//
//   3. Give three current assets.
//   ANSWER: Cash; Receivables; Inventory
//
// Optional per item: TOPIC:, DIFFICULTY: (or LEVEL:), POINTS:, TYPE:.
// "*B. Cash" marks the correct choice instead of an ANSWER line.

// Only digits start a question: "I.", "II." statements stay inside the stem.
const RE_NUMBER = /^\s*(\d{1,3})[.)]\s+(.*)$/;
const RE_CHOICE = /^\s*(\*)?\s*\(?([A-Fa-f])[.)]\s*(.*)$/;
const RE_META = /^\s*(ANSWER|ANS|KEY|TOPIC|DIFFICULTY|LEVEL|POINTS|PTS|TYPE)\s*[:：]\s*(.*)$/i;

type Pending = {
  n: number;
  label?: string; // the printed number, e.g. "12", for matching an answer key
  stem: string[];
  choices: string[];
  marked?: number;
  answer?: string;
  topic?: string;
  difficulty?: string;
  points?: string;
  type?: string;
};

/** Adds "A. x" or several on one line ("A. x   B. y   C. z"); "*" marks the correct one. */
function addChoices(cur: Pending, line: string) {
  let rest = line;
  for (;;) {
    const m = rest.match(RE_CHOICE);
    if (!m) break;
    const expected = CHOICE_KEYS[cur.choices.length];
    let text = m[3];
    let next = "";
    // Split before the next letter in sequence, e.g. "  B. " after choice A.
    const following = CHOICE_KEYS[cur.choices.length + 1];
    if (following) {
      const split = text.match(new RegExp(`^(.*?\\S)\\s+(\\*?\\s*\\(?[${following}${following.toLowerCase()}][.)]\\s+.*)$`));
      if (split) {
        text = split[1];
        next = split[2];
      }
    }
    if (m[2].toUpperCase() !== expected && cur.choices.length > 0) {
      // Out-of-sequence letter: treat the line as continuation text.
      cur.choices[cur.choices.length - 1] += ` ${rest.trim()}`;
      return;
    }
    if (m[1]) cur.marked = cur.choices.length;
    cur.choices.push(text.trim());
    if (!next) return;
    rest = next;
  }
}

/**
 * A separate key after the questions:
 *   ANSWER KEY
 *   1. B      2. C      3. Going concern
 * Several entries per line are fine.
 */
function splitAnswerKey(text: string): { body: string; key: Map<string, string> } {
  const key = new Map<string, string>();
  const m = text.match(/^[ \t]*answer\s*key\b.*$/im);
  if (!m || m.index === undefined) return { body: text, key };
  const keyText = text.slice(m.index + m[0].length);
  const entry = /(\d{1,3})\s*[.):-]\s*(.+?)(?=\s+\d{1,3}\s*[.):-]\s|\s*$)/gm;
  for (const e of keyText.matchAll(entry)) key.set(e[1], e[2].trim());
  return { body: text.slice(0, m.index), key };
}

export function parseText(text: string, courseId: string, defaults: ImportDefaults): ParsedItem[] {
  const { body, key: answerKey } = splitAnswerKey(text);
  text = body;
  const out: ParsedItem[] = [];
  // Widened on purpose: cur is reassigned inside start()/finish(), which TS does not track.
  let cur = null as Pending | null;
  let count = 0;

  const finish = () => {
    if (!cur) return;
    const c = cur;
    cur = null;
    if (c.stem.join("").trim() === "" && c.choices.length === 0) return;
    const r = buildDraft(courseId, defaults, {
      typeHint: c.type,
      stem: c.stem.join("\n").trim(),
      choices: c.choices,
      markedCorrect: c.marked,
      answer: c.answer ?? (c.marked === undefined && c.label ? (answerKey.get(c.label) ?? "") : ""),
      topic: c.topic,
      difficulty: c.difficulty,
      points: c.points,
    });
    out.push({ source: `Item ${c.n}`, ...r });
  };
  const start = (firstLine: string, label?: string) => {
    finish();
    count += 1;
    cur = { n: count, label, stem: firstLine ? [firstLine] : [], choices: [] };
  };

  // Word often pastes non-breaking spaces and tabs after "1." / "A.".
  const lines = text.replace(/\r\n?/g, "\n").replace(/[ \t]/g, " ").split("\n");
  let afterAnswer = false;

  for (const raw of lines) {
    const line = raw.trimEnd();
    if (!line.trim()) continue;

    const meta = line.match(RE_META);
    if (meta) {
      const key = meta[1].toUpperCase();
      const value = meta[2].trim();
      if (!cur) continue;
      // Meta lines right after ANSWER still belong to that item.
      if (key === "ANSWER" || key === "ANS" || key === "KEY") {
        cur.answer = value;
        afterAnswer = true;
      } else if (key === "TOPIC") cur.topic = value;
      else if (key === "DIFFICULTY" || key === "LEVEL") cur.difficulty = value;
      else if (key === "POINTS" || key === "PTS") cur.points = value;
      else if (key === "TYPE") cur.type = value;
      continue;
    }

    const num = line.match(RE_NUMBER);
    const choice = line.match(RE_CHOICE);

    // A numbered line, or any text after an item's ANSWER, starts the next item.
    if (num || !cur || afterAnswer) {
      afterAnswer = false;
      start(num ? num[2] : line.trim(), num?.[1]);
      continue;
    }
    if (choice && cur.stem.length > 0) {
      addChoices(cur, line);
      continue;
    }
    // Continuation: extends the last choice, or the stem.
    if (cur.choices.length > 0) cur.choices[cur.choices.length - 1] += ` ${line.trim()}`;
    else cur.stem.push(line.trim());
  }
  finish();
  return out;
}

// ---------------------------------------------------------------------------
// Spreadsheet format (xlsx / csv / pasted cells)
// ---------------------------------------------------------------------------
export const TEMPLATE_HEADERS = [
  "Type",
  "Question",
  "A",
  "B",
  "C",
  "D",
  "E",
  "Answer",
  "Topic",
  "Difficulty",
  "Points",
] as const;

export const TEMPLATE_ROWS: string[][] = [
  ["MCQ", "Which of the following is an asset?", "Revenue", "Cash", "Expense", "Dividends", "", "B", "Basics", "Easy", "1"],
  ["Identification", "The assumption that the entity will continue operating for the foreseeable future.", "", "", "", "", "", "Going concern / Going concern assumption", "Basics", "Average", "2"],
  ["Enumeration", "Give three current assets.", "", "", "", "", "", "Cash; Receivables / Accounts receivable; Inventory", "Basics", "Difficult", ""],
];

type Column = "type" | "question" | "answer" | "topic" | "difficulty" | "points" | `choice${number}`;

function headerToColumn(h: string): Column | null {
  const k = h.trim().toLowerCase().replace(/[^a-z]/g, "");
  if (["type", "itemtype", "questiontype"].includes(k)) return "type";
  if (["question", "stem", "item", "questions"].includes(k)) return "question";
  if (["answer", "answers", "key", "answerkey", "correctanswer", "correct"].includes(k)) return "answer";
  if (["topic", "topics", "lesson", "chapter"].includes(k)) return "topic";
  if (["difficulty", "level"].includes(k)) return "difficulty";
  if (["points", "point", "pts", "score"].includes(k)) return "points";
  const letter = k.match(/^(?:choice|option)?([a-f])$/)?.[1];
  if (letter) return `choice${letter.charCodeAt(0) - 97}`;
  return null;
}

/** Cells from xlsx/csv/pasted table → items. The first row may be a header. */
export function parseRows(rows: string[][], courseId: string, defaults: ImportDefaults): ParsedItem[] {
  const clean = rows.map((r) => r.map((c) => (c ?? "").toString().trim()));
  const nonEmpty = clean.filter((r) => r.some(Boolean));
  if (nonEmpty.length === 0) return [];

  const headerCols = clean[0].map(headerToColumn);
  const hasHeader = headerCols.includes("question");
  const cols: (Column | null)[] = hasHeader
    ? headerCols
    : TEMPLATE_HEADERS.map((h) => headerToColumn(h));

  const out: ParsedItem[] = [];
  clean.forEach((row, i) => {
    if (hasHeader && i === 0) return;
    if (!row.some(Boolean)) return;
    const get = (c: Column) => {
      const idx = cols.indexOf(c);
      return idx >= 0 ? (row[idx] ?? "") : "";
    };
    const choices: string[] = [];
    for (let n = 0; n < CHOICE_KEYS.length; n++) {
      const idx = cols.indexOf(`choice${n}`);
      if (idx >= 0) choices.push(row[idx] ?? "");
    }
    // Keep positions (A..F) even if a middle choice is blank, then drop trailing blanks.
    while (choices.length && !choices[choices.length - 1]) choices.pop();
    if (choices.some((c) => !c)) {
      out.push({ source: `Row ${i + 1}`, error: "A choice in the middle is blank." });
      return;
    }
    const r = buildDraft(courseId, defaults, {
      typeHint: get("type"),
      stem: get("question"),
      choices,
      answer: get("answer"),
      topic: get("topic"),
      difficulty: get("difficulty"),
      points: get("points"),
    });
    out.push({ source: `Row ${i + 1}`, ...r });
  });
  return out;
}

/** Minimal CSV/TSV parser (quoted fields, embedded commas/newlines). */
export function parseDelimited(text: string): string[][] {
  const firstLine = text.split(/\r?\n/, 1)[0] ?? "";
  const delim = firstLine.includes("\t") ? "\t" : firstLine.split(";").length > firstLine.split(",").length ? ";" : ",";
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') {
        field += '"';
        i++;
      } else if (ch === '"') quoted = false;
      else field += ch;
    } else if (ch === '"' && field === "") quoted = true;
    else if (ch === delim) {
      row.push(field);
      field = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else field += ch;
  }
  if (field || row.length) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

export function toCsv(rows: readonly (readonly string[])[]): string {
  return rows
    .map((r) => r.map((c) => (/[",\n]/.test(c) ? `"${c.replace(/"/g, '""')}"` : c)).join(","))
    .join("\r\n");
}

/** Marks items whose question already exists in the bank (or twice in the file). */
export function markDuplicates(items: ParsedItem[], existingStems: string[]): ParsedItem[] {
  const seen = new Set(existingStems.map(normalizeAnswer));
  return items.map((it) => {
    if (!it.draft) return it;
    const key = normalizeAnswer(it.draft.stem);
    const duplicate = seen.has(key);
    seen.add(key);
    return { ...it, duplicate };
  });
}
