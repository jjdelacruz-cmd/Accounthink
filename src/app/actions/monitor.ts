"use server";

import { requireRole } from "@/lib/auth";
import type { MonitorData, MonitorEvent } from "@/lib/monitor";
import { createClient } from "@/lib/supabase/server";

export async function getMonitor(examId: string): Promise<{ error?: string; data?: MonitorData }> {
  await requireRole("instructor", "admin");
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("exam_monitor", { p_exam_id: examId });
  if (error) return { error: error.message };
  return { data: data as MonitorData };
}

export async function getAccessCode(examId: string): Promise<{ error?: string; code?: string; seconds_left?: number }> {
  await requireRole("instructor", "admin");
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("current_access_code", { p_exam_id: examId });
  if (error) return { error: error.message };
  return data as { code: string; seconds_left: number };
}

export async function extendAttempt(attemptId: string, minutes: number): Promise<{ error?: string }> {
  await requireRole("instructor", "admin");
  const supabase = await createClient();
  const { error } = await supabase.rpc("extend_attempt", { p_attempt_id: attemptId, p_minutes: minutes });
  return error ? { error: error.message } : {};
}

export async function endAttempt(attemptId: string): Promise<{ error?: string }> {
  await requireRole("instructor", "admin");
  const supabase = await createClient();
  const { error } = await supabase.rpc("end_attempt", { p_attempt_id: attemptId });
  return error ? { error: error.message } : {};
}

export async function getAttemptEvents(attemptId: string): Promise<{ error?: string; events?: MonitorEvent[] }> {
  await requireRole("instructor", "admin");
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("integrity_events")
    .select("id, kind, detail, created_at")
    .eq("attempt_id", attemptId)
    .order("created_at", { ascending: false })
    .limit(200);
  if (error) return { error: error.message };
  return { events: data as MonitorEvent[] };
}
