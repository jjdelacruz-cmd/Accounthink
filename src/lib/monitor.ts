export type MonitorAttempt = {
  id: string;
  started_at: string;
  deadline_at: string;
  submitted_at: string | null;
  end_reason: string | null;
  score: number | null;
  max_score: number | null;
  last_seen_at: string | null;
  device: string | null;
  answered: number;
  leaves: number;
  away_seconds: number;
  copy_paste: number;
  device_flags: number;
};

export type MonitorStudent = {
  student_id: string;
  full_name: string;
  student_no: string | null;
  section: string | null;
  attempt: MonitorAttempt | null;
};

export type MonitorData = {
  server_now: string;
  exam: {
    id: string;
    title: string;
    status: "draft" | "published" | "closed";
    time_limit_minutes: number;
    total_items: number;
    require_access_code: boolean;
    leave_limit: number | null;
  };
  students: MonitorStudent[];
};

export type MonitorEvent = {
  id: number;
  kind: string;
  detail: Record<string, unknown> | null;
  created_at: string;
};

export const EVENT_LABEL: Record<string, string> = {
  left_app: "Left the exam screen",
  returned: "Came back",
  copy: "Tried to copy",
  cut: "Tried to cut",
  paste: "Tried to paste",
  context_menu: "Long-press / right-click menu",
  print_key: "Pressed Print Screen",
  device_changed: "Switched to another device",
  session_takeover: "Opened in another tab/window",
  code_failed: "Wrong access code on another device",
};

export type StudentStatus = "not_started" | "in_progress" | "submitted";

export function statusOf(s: MonitorStudent): StudentStatus {
  if (!s.attempt) return "not_started";
  return s.attempt.submitted_at ? "submitted" : "in_progress";
}

export function isFlagged(s: MonitorStudent): boolean {
  const a = s.attempt;
  return !!a && (a.leaves > 0 || a.copy_paste > 0 || a.device_flags > 0);
}

export function formatDuration(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return s ? `${m}m ${s}s` : `${m}m`;
}
