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
  leave_count: number;
  leave_limit: number | null;
  student_name: string;
  student_no: string | null;
};

export type DeviceInfo = { hash: string; label: string };

export type IntegrityEvent = {
  kind: "left_app" | "returned" | "copy" | "cut" | "paste" | "context_menu" | "print_key";
  detail?: Record<string, unknown>;
};

export const END_REASON_LABEL: Record<string, string> = {
  student: "Submitted by student",
  timeout: "Time ran out",
  closed: "Exam was closed",
  instructor: "Ended by instructor",
  leave_limit: "Auto-submitted: left the exam too many times",
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
  require_access_code: boolean;
  leave_limit: number | null;
  is_open: boolean;
  server_now: string;
  attempt: {
    id: string;
    started_at: string;
    deadline_at: string;
    submitted_at: string | null;
    end_reason: string | null;
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

export type FeedbackMode = "off" | "marks" | "answers";

export const FEEDBACK_LABEL: Record<FeedbackMode, string> = {
  off: "Score only (no feedback)",
  marks: "Which questions they got right or wrong",
  answers: "Right or wrong, plus the correct answers",
};

/** One question in a student's own feedback, from my_exam_feedback(). Keys only when show_answers. */
export type FeedbackItem = {
  index: number;
  type: ItemType;
  stem: string;
  points: number;
  points_awarded: number;
  answer: StudentAnswer | null;
  choices: { key: string; text: string; is_key: boolean | null }[] | null;
  key: { accepted: string[] } | { answers: string[][]; any_order?: boolean } | null;
};

export type ExamFeedback =
  | { status: "not_submitted" | "off" }
  | { status: "after_close"; closes_at: string | null }
  | { status: "ready"; show_answers: boolean; items: FeedbackItem[] };
