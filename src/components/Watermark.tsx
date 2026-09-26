/** Faint repeating name/ID overlay so screenshots of questions identify the student. */
export function Watermark({ text }: { text: string }) {
  const rows = Array.from({ length: 14 });
  return (
    <div aria-hidden className="pointer-events-none fixed inset-0 z-10 overflow-hidden select-none">
      <div className="absolute -inset-[50%] flex -rotate-[24deg] flex-col justify-around">
        {rows.map((_, i) => (
          <p
            key={i}
            className="whitespace-nowrap text-sm font-semibold tracking-wide text-slate-900/[0.07]"
            style={{ marginLeft: i % 2 ? "-6rem" : 0 }}
          >
            {Array.from({ length: 8 }, () => text).join("      ")}
          </p>
        ))}
      </div>
    </div>
  );
}
