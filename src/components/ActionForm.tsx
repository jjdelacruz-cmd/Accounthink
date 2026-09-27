"use client";

import { useActionState, useEffect, useRef, type ReactNode } from "react";
import { useKeepFormValues } from "@/lib/useKeepFormValues";
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
  const { remember, restore } = useKeepFormValues(formRef);

  // Success on a "create" form: clear it. Otherwise (errors, or settings forms):
  // put back what the user submitted, since React resets the form after an action.
  useEffect(() => {
    if (!state) return;
    if (resetOnSuccess && state.message) formRef.current?.reset();
    else restore();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state, resetOnSuccess]);

  return (
    // Native action (not onSubmit + preventDefault) so the form still submits
    // before the page has hydrated on a slow phone.
    <form ref={formRef} action={formAction} onSubmit={remember} className={className}>
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
