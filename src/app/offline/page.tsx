import { StatusScreen, buttonClass } from "@/components/ui";

export const dynamic = "force-static";

export default function OfflinePage() {
  return (
    <StatusScreen
      icon="wifi-off"
      title="You're offline"
      actions={
        /* Full reload on purpose: it recovers from errors/offline where client navigation would not. */
        /* eslint-disable-next-line @next/next/no-html-link-for-pages */
        <a href="/" className={buttonClass({ className: "px-6" })}>
          Try again
        </a>
      }
    >
      <p>Accounthink needs the internet. Check your Wi-Fi or mobile data, then try again.</p>
      <p className="text-sm text-ink-600">
        If you were taking an exam, your saved answers are safe, but your timer keeps running.
      </p>
    </StatusScreen>
  );
}
