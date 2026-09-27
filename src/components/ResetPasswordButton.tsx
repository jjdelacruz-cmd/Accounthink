"use client";

import { useState, useTransition } from "react";
import { resetUserPassword } from "@/app/actions/account";

// No look-alike characters (0/O, 1/l/I) so it's easy to read out or copy by hand.
const ALPHABET = "abcdefghjkmnpqrstuvwxyz23456789";

function tempPassword() {
  const bytes = crypto.getRandomValues(new Uint8Array(10));
  const s = Array.from(bytes, (b) => ALPHABET[b % ALPHABET.length]).join("");
  return `${s.slice(0, 5)}-${s.slice(5)}`;
}

export function ResetPasswordButton({ userId, name }: { userId: string; name: string }) {
  const [pending, start] = useTransition();
  const [result, setResult] = useState<{ password?: string; error?: string }>();

  return (
    <div className="space-y-1">
      <button
        type="button"
        disabled={pending}
        onClick={() => {
          if (!confirm(`Set a new temporary password for ${name}? They'll be signed out and must use it next time.`)) return;
          const password = tempPassword();
          start(async () => {
            const res = await resetUserPassword(userId, password);
            setResult(res.error ? { error: res.error } : { password });
          });
        }}
        className="rounded-lg border border-slate-300 px-2.5 py-1 text-xs font-semibold disabled:opacity-50"
      >
        {pending ? "Resetting…" : "Reset password"}
      </button>
      {result?.password && (
        <p className="rounded-lg bg-emerald-50 px-2 py-1 text-xs text-emerald-900">
          New password: <b className="select-all font-mono text-sm">{result.password}</b>
          <br />
          Give this to {name}. It&apos;s shown only once; they can change it under Account.
        </p>
      )}
      {result?.error && <p className="text-xs text-red-700">{result.error}</p>}
    </div>
  );
}
