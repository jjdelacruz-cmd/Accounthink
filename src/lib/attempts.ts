import type { Choice, ItemType } from "@/lib/items";

export type StudentAnswer = { choice?: string } | { text?: string } | { items?: string[] };

/** One question as served by attempt_question() — never includes the key. */
export type Question = {
  index: number;
  total: number;
  type: ItemType;
  stem: string;
  points: number;
  choices: Choice[] | null;
  slots: number | null;
  answer: StudentAnswer | null;
};

export type AttemptState = {
  attempt_id: string;
  exam_id: string;
  title: string;
  deadline_at: string;
  server_now: string;
  total: number;
  answered: number[];
};

export type StudentExamInfo = {
  id: string;
  title: string;
  kind: string;
  instructions: string | null;
  time_limit_minutes: number;
  opens_at: string | null;
  closes_at: string | null;
  status: "published" | "closed";
  item_count: number;
  is_open: boolean;
  server_now: string;
  attempt: {
    id: string;
    started_at: string;
    deadline_at: string;
    submitted_at: string | null;
    score: number | null;
    max_score: number | null;
  } | null;
};

export function isAnswered(a: StudentAnswer | null | undefined): boolean {
  if (!a) return false;
  if ("choice" in a) return !!a.choice;
  if ("text" in a) return !!a.text?.trim();
  if ("items" in a) return !!a.items?.some((x) => x.trim());
  return false;
}
