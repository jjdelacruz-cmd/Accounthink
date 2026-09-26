import type { ComponentProps, ReactNode } from "react";

export function Card({ children, className = "" }: { children: ReactNode; className?: string }) {
  return (
    <div className={`rounded-2xl border border-slate-200 bg-white p-4 shadow-sm ${className}`}>
      {children}
    </div>
  );
}

export function Field({
  label,
  className = "",
  ...props
}: { label: string } & ComponentProps<"input">) {
  return (
    <label className="block">
      <span className="mb-1 block text-sm font-medium text-slate-700">{label}</span>
      <input
        {...props}
        className={`block w-full rounded-xl border border-slate-300 bg-white px-3 py-3 text-base outline-none focus:border-emerald-600 focus:ring-2 focus:ring-emerald-600/20 ${className}`}
      />
    </label>
  );
}

export function Button({
  variant = "primary",
  className = "",
  ...props
}: { variant?: "primary" | "secondary" | "danger" } & ComponentProps<"button">) {
  const styles = {
    primary: "bg-emerald-700 text-white hover:bg-emerald-800",
    secondary: "border border-slate-300 bg-white text-slate-800 hover:bg-slate-50",
    danger: "bg-red-600 text-white hover:bg-red-700",
  }[variant];
  return (
    <button
      {...props}
      className={`min-h-12 rounded-xl px-4 py-3 text-base font-semibold disabled:opacity-50 ${styles} ${className}`}
    />
  );
}

export function Notice({ kind, children }: { kind: "error" | "ok"; children: ReactNode }) {
  const styles =
    kind === "error"
      ? "border-red-200 bg-red-50 text-red-800"
      : "border-emerald-200 bg-emerald-50 text-emerald-800";
  return <p className={`rounded-xl border px-3 py-2 text-sm ${styles}`}>{children}</p>;
}
