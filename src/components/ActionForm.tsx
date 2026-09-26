"use client";

import { useActionState, useEffect, useRef, type ReactNode } from "react";
import type { FormState } from "@/app/actions/auth";
import { Button, Notice } from "@/components/ui";

/** Form bound to a server action returning FormState; shows its error/message. */
export function ActionForm({
  action,
  submitLabel,
  pendingLabel,
  children,
  className = "space-y-3",
  resetOnSuccess = true,
}: {
  action: (state: FormState, formData: FormData) => Promise<FormState>;
  submitLabel: string;
  pendingLabel?: string;
  children?: ReactNode;
  className?: string;
  resetOnSuccess?: boolean;
}) {
  const [state, formAction, pending] = useActionState(action, undefined);
  const formRef = useRef<HTMLFormElement>(null);

  useEffect(() => {
    if (resetOnSuccess && state?.message) formRef.current?.reset();
  }, [state, resetOnSuccess]);

  return (
    <form ref={formRef} action={formAction} className={className}>
      {children}
      {state?.error && <Notice kind="error">{state.error}</Notice>}
      {state?.message && <Notice kind="ok">{state.message}</Notice>}
      <Button type="submit" disabled={pending} className="w-full sm:w-auto">
        {pending ? (pendingLabel ?? "Saving…") : submitLabel}
      </Button>
    </form>
  );
}
