/** A round photo, or the person's initials when there is none. */
export function Avatar({
  name,
  src,
  size = 40,
  className = "",
}: {
  name: string;
  src?: string | null;
  size?: number;
  className?: string;
}) {
  const initials =
    name
      .split(/[\s,]+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((w) => w[0]!.toUpperCase())
      .join("") || "?";
  const box = { width: size, height: size, fontSize: Math.max(11, Math.round(size * 0.38)) };
  if (src) {
    // eslint-disable-next-line @next/next/no-img-element -- a small data URL; nothing to optimize
    return <img src={src} alt="" style={box} className={`shrink-0 rounded-full object-cover ${className}`} />;
  }
  return (
    <span
      aria-hidden
      style={box}
      className={`flex shrink-0 items-center justify-center rounded-full bg-brand-100 font-bold text-brand-800 ${className}`}
    >
      {initials}
    </span>
  );
}
