"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

export type FormState = { error?: string; message?: string } | undefined;

// Auth errors with a status came from Supabase; anything else is a network failure.
function authError(error: { message: string; status?: number }): FormState {
  if (!error.status) return { error: "Can't reach the server. Check your internet and try again." };
  return { error: error.message };
}

export async function login(_: FormState, formData: FormData): Promise<FormState> {
  const email = String(formData.get("email") ?? "").trim();
  const password = String(formData.get("password") ?? "");
  if (!email || !password) return { error: "Enter your email and password." };

  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) return authError(error);

  redirect("/");
}

export async function signup(_: FormState, formData: FormData): Promise<FormState> {
  const fullName = String(formData.get("full_name") ?? "").trim();
  const studentNo = String(formData.get("student_no") ?? "").trim();
  const email = String(formData.get("email") ?? "").trim();
  const password = String(formData.get("password") ?? "");

  if (!fullName || !email || !password) return { error: "Name, email and password are required." };
  if (password.length < 8) return { error: "Password must be at least 8 characters." };

  const supabase = await createClient();
  const { data, error } = await supabase.auth.signUp({
    email,
    password,
    // Role is never taken from here; the DB trigger always creates a student.
    options: { data: { full_name: fullName, student_no: studentNo } },
  });
  if (error) return authError(error);

  // Email confirmation on: no session yet.
  if (!data.session) {
    return { message: "Account created. Check your email to confirm, then sign in." };
  }
  redirect("/");
}
