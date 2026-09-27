"use client";

import { useEffect, useState } from "react";

type BeforeInstallPromptEvent = Event & { prompt: () => Promise<void>; userChoice: Promise<{ outcome: string }> };

const DISMISS_KEY = "install-prompt-dismissed";

/** "Install app" card: native prompt on Android/Chrome, instructions on iPhone. */
export function InstallPrompt() {
  const [deferred, setDeferred] = useState<BeforeInstallPromptEvent | null>(null);
  const [ios, setIos] = useState(false);
  const [hidden, setHidden] = useState(true);

  useEffect(() => {
    const standalone =
      window.matchMedia("(display-mode: standalone)").matches ||
      (navigator as Navigator & { standalone?: boolean }).standalone === true;
    let dismissed = false;
    try {
      dismissed = localStorage.getItem(DISMISS_KEY) === "1";
    } catch {
      /* private mode */
    }
    if (standalone || dismissed) return;

    const isIos = /iPhone|iPad|iPod/.test(navigator.userAgent);
    // eslint-disable-next-line react-hooks/set-state-in-effect -- browser-only APIs (userAgent, display-mode) can only be read after mount
    setIos(isIos);
    if (isIos) setHidden(false);

    const onPrompt = (e: Event) => {
      e.preventDefault();
      setDeferred(e as BeforeInstallPromptEvent);
      setHidden(false);
    };
    window.addEventListener("beforeinstallprompt", onPrompt);
    return () => window.removeEventListener("beforeinstallprompt", onPrompt);
  }, []);

  if (hidden) return null;

  const dismiss = () => {
    setHidden(true);
    try {
      localStorage.setItem(DISMISS_KEY, "1");
    } catch {
      /* private mode */
    }
  };

  return (
    <div className="flex items-start gap-3 rounded-2xl border border-emerald-200 bg-emerald-50 p-3">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src="/icons/icon-192.png" alt="" width={40} height={40} className="shrink-0 rounded-xl" />
      <div className="min-w-0 flex-1 text-sm">
        <p className="font-semibold text-emerald-900">Install Accounthink</p>
        {ios ? (
          <p className="text-emerald-900">
            Tap <b>Share</b> <span aria-hidden>⎋</span> then <b>Add to Home Screen</b> to open it like an app.
          </p>
        ) : (
          <p className="text-emerald-900">Add it to your home screen and open it like an app.</p>
        )}
        <div className="mt-2 flex gap-2">
          {deferred && (
            <button
              onClick={async () => {
                await deferred.prompt();
                await deferred.userChoice;
                setDeferred(null);
                setHidden(true);
              }}
              className="rounded-lg bg-emerald-700 px-3 py-1.5 font-semibold text-white"
            >
              Install
            </button>
          )}
          <button onClick={dismiss} className="rounded-lg px-3 py-1.5 font-medium text-emerald-900">
            Not now
          </button>
        </div>
      </div>
    </div>
  );
}
