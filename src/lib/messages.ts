export type Thread = {
  me: string;
  other: { id: string; full_name: string; avatar: string | null; role: string; can_reply: boolean };
  messages: { id: number; mine: boolean; body: string; created_at: string }[];
};

export type InboxRow = {
  other_id: string;
  full_name: string;
  avatar: string | null;
  role: string;
  last_body: string;
  last_at: string;
  last_mine: boolean;
  unread: number;
};

export type Contact = { id: string; full_name: string; role: "student" | "instructor"; detail: string | null };
