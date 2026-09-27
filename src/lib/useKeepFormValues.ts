"use client";

import { useRef, type FormEvent, type RefObject } from "react";

/**
 * React 19 resets a <form action={fn}> after every submission, which would wipe the
 * user's input when the server returns an error. We keep the native form action
 * (so forms still work before the page finishes hydrating on slow phones) and put
 * the submitted values back after the reset.
 *
 * Usage: <form ref={ref} action={formAction} onSubmit={remember}>; call restore()
 * when the action's result arrives and the input should stay.
 */
export function useKeepFormValues(formRef: RefObject<HTMLFormElement | null>) {
  const snapshot = useRef<FormData | null>(null);

  const remember = (e: FormEvent<HTMLFormElement>) => {
    const submitter = (e.nativeEvent as SubmitEvent).submitter as HTMLElement | null;
    snapshot.current = new FormData(e.currentTarget, submitter);
  };

  const restore = () => {
    const form = formRef.current;
    const data = snapshot.current;
    if (!form || !data) return;
    for (const el of Array.from(form.elements)) {
      if (!(el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement || el instanceof HTMLSelectElement)) continue;
      if (!el.name) continue;
      if (el instanceof HTMLInputElement) {
        if (["hidden", "file", "submit", "button", "password"].includes(el.type)) continue;
        if (el.type === "checkbox" || el.type === "radio") {
          el.checked = data.getAll(el.name).includes(el.value);
          continue;
        }
      }
      const v = data.get(el.name);
      if (typeof v === "string") el.value = v;
    }
  };

  return { remember, restore };
}

