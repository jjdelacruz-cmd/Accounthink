import type { DeviceInfo } from "@/lib/attempts";

/** Short readable label like "Android · Chrome" for the instructor's monitor. */
function deviceLabel(ua: string): string {
  const os = /iPhone/.test(ua)
    ? "iPhone"
    : /iPad/.test(ua)
      ? "iPad"
      : /Android/.test(ua)
        ? "Android"
        : /Windows/.test(ua)
          ? "Windows"
          : /Mac OS X/.test(ua)
            ? "Mac"
            : /CrOS/.test(ua)
              ? "Chromebook"
              : /Linux/.test(ua)
                ? "Linux"
                : "Unknown";
  const browser = /Edg\//.test(ua)
    ? "Edge"
    : /SamsungBrowser/.test(ua)
      ? "Samsung Internet"
      : /OPR\/|Opera/.test(ua)
        ? "Opera"
        : /Firefox|FxiOS/.test(ua)
          ? "Firefox"
          : /Chrome|CriOS/.test(ua)
            ? "Chrome"
            : /Safari/.test(ua)
              ? "Safari"
              : "Browser";
  return `${os} · ${browser}`;
}

/**
 * A basic device fingerprint: stable across reloads on one phone, different on
 * another phone or laptop. Not tamper-proof — it's one signal among several.
 */
export async function getDeviceInfo(): Promise<DeviceInfo> {
  const parts = [
    navigator.userAgent,
    `${screen.width}x${screen.height}@${window.devicePixelRatio}`,
    Intl.DateTimeFormat().resolvedOptions().timeZone,
    navigator.language,
    String(navigator.hardwareConcurrency ?? ""),
    String(navigator.maxTouchPoints ?? ""),
  ].join("|");

  let hash: string;
  try {
    const bytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(parts));
    hash = Array.from(new Uint8Array(bytes), (b) => b.toString(16).padStart(2, "0")).join("");
  } catch {
    // crypto.subtle needs HTTPS; fall back to a simple string hash.
    let h = 0;
    for (let i = 0; i < parts.length; i++) h = (Math.imul(31, h) + parts.charCodeAt(i)) | 0;
    hash = `s${(h >>> 0).toString(16)}`;
  }
  return { hash, label: deviceLabel(navigator.userAgent) };
}
