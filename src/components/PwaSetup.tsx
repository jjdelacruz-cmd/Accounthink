"use client";

import { useEffect } from "react";

/** Registers the service worker (production only). */
export function PwaSetup() {
  useEffect(() => {
    if (process.env.NODE_ENV !== "production" || !("serviceWorker" in navigator)) return;
    navigator.serviceWorker.register("/sw.js").catch(() => {
      /* not critical: the app works without it */
    });
  }, []);
  return null;
}
