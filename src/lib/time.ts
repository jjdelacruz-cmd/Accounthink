// All exam times are entered and shown in Philippine time, whatever the server's zone.
const TZ = "Asia/Manila";
const OFFSET = "+08:00"; // PH has no DST

/** "2026-10-05T08:00" (datetime-local, PH time) → ISO string, or null if blank. */
export function manilaInputToIso(value: string): string | null {
  if (!value) return null;
  const d = new Date(`${value}:00${OFFSET}`);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

/** ISO → "2026-10-05T08:00" for a datetime-local input, in PH time. */
export function isoToManilaInput(iso: string | null): string {
  if (!iso) return "";
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date(iso));
  const get = (t: string) => parts.find((p) => p.type === t)?.value;
  return `${get("year")}-${get("month")}-${get("day")}T${get("hour")}:${get("minute")}`;
}

/** ISO → "Mon, Oct 5, 8:00 AM" in PH time. */
export function formatManila(iso: string | null): string {
  if (!iso) return "—";
  return new Intl.DateTimeFormat("en-PH", {
    timeZone: TZ,
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(iso));
}
