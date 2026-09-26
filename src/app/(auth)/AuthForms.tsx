"use client";

import Link from "next/link";
import { useActionState } from "react";
import { login, signup } from "@/app/actions/auth";
import { Button, Field, Notice } from "@/components/ui";

export function LoginForm({ confirmError }: { confirmError?: boolean }) {
  const [state, action, pending] = useActionState(login, undefined);
  return (
    <form action={action} className="space-y-4">
      {confirmError && <Notice kind="error">That confirmation link is invalid or expired.</Notice>}
      {state?.error && <Notice kind="error">{state.error}</Notice>}
      <Field label="Email" name="email" type="email" autoComplete="email" required />
      <Field label="Password" name="password" type="password" autoComplete="current-password" required />
      <Button type="submit" disabled={pending} className="w-full">
        {pending ? "Signing in…" : "Sign in"}
      </Button>
      <p className="text-center text-sm text-slate-600">
        New here?{" "}
        <Link href="/signup" className="font-semibold text-emerald-700">
          Create an account
        </Link>
      </p>
    </form>
  );
}

export function SignupForm() {
  const [state, action, pending] = useActionState(signup, undefined);
  if (state?.message) {
    return (
      <div className="space-y-4">
        <Notice kind="ok">{state.message}</Notice>
        <Link href="/login" className="block text-center font-semibold text-emerald-700">
          Go to sign in
        </Link>
      </div>
    );
  }
  return (
    <form action={action} className="space-y-4">
      {state?.error && <Notice kind="error">{state.error}</Notice>}
      <Field label="Full name (Last, First M.I.)" name="full_name" autoComplete="name" required />
      <Field label="Student number (students only)" name="student_no" inputMode="numeric" />
      <Field label="Email" name="email" type="email" autoComplete="email" required />
      <Field label="Password (min. 8 characters)" name="password" type="password" autoComplete="new-password" minLength={8} required />
      <Button type="submit" disabled={pending} className="w-full">
        {pending ? "Creating account…" : "Create account"}
      </Button>
      <p className="text-center text-sm text-slate-600">
        Already have an account?{" "}
        <Link href="/login" className="font-semibold text-emerald-700">
          Sign in
        </Link>
      </p>
    </form>
  );
}
