"use server";

import { requireRole } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import type { Thread } from "@/lib/messages";

export async function sendMessage(to: string, body: string): Promise<{ error?: string }> {
  await requireRole("student", "instructor", "admin");
  const text = body.trim();
  if (!text) return { error: "Write a message first." };
  if (text.length > 2000) return { error: "Messages can be up to 2,000 characters." };
  const supabase = await createClient();
  const { error } = await supabase.rpc("send_message", { p_to: to, p_body: text });
  return error ? { error: error.message } : {};
}

/** Latest messages of one conversation (also marks the other person's messages as read). */
export async function getThread(other: string): Promise<{ error?: string; thread?: Thread }> {
  await requireRole("student", "instructor", "admin");
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("message_thread", { p_other: other });
  if (error || !data) return { error: error?.message ?? "Not found" };
  return { thread: data as Thread };
}
