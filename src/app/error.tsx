"use client";

import { StatusScreen, buttonClass } from "@/components/ui";

export default function ErrorPage({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <StatusScreen
      icon="alert"
      title="Something went wrong"
      actions={
        <>
          <button onClick={reset} className={buttonClass({ className: "px-6" })}>
            Try again
          </button>
          {/* Full reload on purpose: it recovers from errors/offline where client navigation would not. */}
          {/* eslint-disable-next-line @next/next/no-html-link-for-pages */}
          <a href="/" className={buttonClass({ variant: "secondary", className: "px-6" })}>
            Home
          </a>
        </>
      }
    >
      <p>Please try again. If you&apos;re in an exam, your saved answers are safe.</p>
    </StatusScreen>
  );
}
