"use client";

import { startTransition, useActionState, useEffect, useRef, type FormEvent, type ReactNode } from "react";
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
  secondarySubmit,
}: {
  action: (state: FormState, formData: FormData) => Promise<FormState>;
  submitLabel: string;
  pendingLabel?: string;
  children?: ReactNode;
  className?: string;
  resetOnSuccess?: boolean;
  /** Extra submit button; its name/value are sent with the form (e.g. intent=publish). */
  secondarySubmit?: { label: string; name: string; value: string };
}) {
  const [state, formAction, pending] = useActionState(action, undefined);
  const formRef = useRef<HTMLFormElement>(null);

  useEffect(() => {
    if (resetOnSuccess && state?.message) formRef.current?.reset();
  }, [state, resetOnSuccess]);

  // Submit manually instead of <form action>: React 19 auto-resets a form after an
  // action, which would wipe the user's input when the server returns an error.
  const onSubmit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const submitter = (e.nativeEvent as SubmitEvent).submitter as HTMLElement | null;
    const data = new FormData(e.currentTarget, submitter);
    startTransition(() => formAction(data));
  };

  return (
    <form ref={formRef} onSubmit={onSubmit} className={className}>
      {children}
      {state?.error && <Notice kind="error">{state.error}</Notice>}
      {state?.message && <Notice kind="ok">{state.message}</Notice>}
      <div className="flex flex-col gap-2 sm:flex-row">
        <Button type="submit" disabled={pending} className="w-full sm:w-auto">
          {pending ? (pendingLabel ?? "Saving…") : submitLabel}
        </Button>
        {secondarySubmit && (
          <Button
            type="submit"
            variant="secondary"
            name={secondarySubmit.name}
            value={secondarySubmit.value}
            disabled={pending}
            className="w-full border-emerald-700 text-emerald-800 sm:w-auto"
          >
            {secondarySubmit.label}
          </Button>
        )}
      </div>
    </form>
  );
}
