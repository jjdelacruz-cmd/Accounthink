import Link from "next/link";
import type { ComponentProps, ReactNode } from "react";
import { Icon, type IconName } from "@/components/icons";

/* Shared UI primitives. The visual rules live in globals.css (@theme tokens + @layer components);
   these wrappers just apply them consistently. All of them work in server and client components. */

const cx = (...parts: (string | false | null | undefined)[]) => parts.filter(Boolean).join(" ");

/* ---------- Layout ---------- */

export function Card({
  children,
  className = "",
  flush = false,
  ...props
}: { children: ReactNode; className?: string; flush?: boolean } & Omit<ComponentProps<"div">, "children" | "className">) {
  return (
    <div {...props} className={cx("card", flush && "card-flush", className)}>
      {children}
    </div>
  );
}

/** Page title (h1). Pass `eyebrow` for a small line above it (e.g. the course code). */
export function PageTitle({
  children,
  eyebrow,
  actions,
  className = "",
}: {
  children: ReactNode;
  eyebrow?: ReactNode;
  actions?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cx("flex flex-wrap items-end justify-between gap-x-3 gap-y-2", className)}>
      <div className="min-w-0">
        {eyebrow && <p className="text-sm font-semibold text-brand-700">{eyebrow}</p>}
        <h1 className="text-title font-bold tracking-tight text-ink-900">{children}</h1>
      </div>
      {actions}
    </div>
  );
}

/** Section title (h2) with an optional right-hand action. */
export function SectionTitle({
  children,
  actions,
  className = "",
  as: Tag = "h2",
}: {
  children: ReactNode;
  actions?: ReactNode;
  className?: string;
  as?: "h2" | "h3";
}) {
  return (
    <div className={cx("flex items-center justify-between gap-2", className)}>
      <Tag className="text-heading font-semibold text-ink-900">{children}</Tag>
      {actions}
    </div>
  );
}

/** "← Back" link shown above a page. */
export function BackLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <Link
      href={href}
      className="-ml-1 inline-flex min-h-10 items-center gap-1 rounded-chip px-1 text-sm font-semibold text-brand-800 hover:underline"
    >
      <Icon name="arrow-left" size={16} />
      <span>{children}</span>
    </Link>
  );
}

export function EmptyState({
  icon,
  title,
  children,
  className = "",
}: {
  icon?: IconName;
  title: string;
  children?: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cx(
        "flex flex-col items-center rounded-card border border-dashed border-ink-300 bg-white/60 px-4 py-8 text-center",
        className,
      )}
    >
      {icon && (
        <span className="mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-brand-50 text-brand-700">
          <Icon name={icon} size={24} />
        </span>
      )}
      <p className="font-semibold text-ink-900">{title}</p>
      {children && <p className="mt-1 max-w-sm text-sm text-ink-600">{children}</p>}
    </div>
  );
}

/* ---------- Forms ---------- */

/** Class string for any text input / select / textarea. */
export const inputClass = "input";
/** Class string for the caption above a field. */
export const labelClass = "mb-1.5 block text-sm font-semibold text-ink-800";

export function Field({
  label,
  hint,
  className = "",
  ...props
}: { label: string; hint?: string } & ComponentProps<"input">) {
  return (
    <label className="block">
      <span className={labelClass}>{label}</span>
      <input {...props} className={cx("input", className)} />
      {hint && <span className="mt-1 block text-xs text-ink-600">{hint}</span>}
    </label>
  );
}

export function SelectField({
  label,
  hint,
  className = "",
  children,
  ...props
}: { label: string; hint?: string } & ComponentProps<"select">) {
  return (
    <label className="block">
      <span className={labelClass}>{label}</span>
      <select {...props} className={cx("input", className)}>
        {children}
      </select>
      {hint && <span className="mt-1 block text-xs text-ink-600">{hint}</span>}
    </label>
  );
}

export function TextAreaField({
  label,
  hint,
  className = "",
  ...props
}: { label: string; hint?: string } & ComponentProps<"textarea">) {
  return (
    <label className="block">
      <span className={labelClass}>{label}</span>
      <textarea {...props} className={cx("input", className)} />
      {hint && <span className="mt-1 block text-xs text-ink-600">{hint}</span>}
    </label>
  );
}

/* ---------- Buttons ---------- */

type Variant = "primary" | "secondary" | "danger" | "ghost";
type Size = "md" | "sm" | "lg";

/** Class string for a button look. Use on <Link> to get a link that looks like a button. */
export function buttonClass({
  variant = "primary",
  size = "md",
  block = false,
  className = "",
}: { variant?: Variant; size?: Size; block?: boolean; className?: string } = {}) {
  return cx(
    "btn",
    `btn-${variant}`,
    size === "sm" && "btn-sm",
    size === "lg" && "btn-lg",
    block && "btn-block",
    className,
  );
}

export function Button({
  variant = "primary",
  size = "md",
  block = false,
  className = "",
  icon,
  children,
  ...props
}: { variant?: Variant; size?: Size; block?: boolean; icon?: IconName } & ComponentProps<"button">) {
  return (
    <button {...props} className={buttonClass({ variant, size, block, className })}>
      {icon && <Icon name={icon} size={size === "sm" ? 16 : 18} />}
      {children}
    </button>
  );
}

export function LinkButton({
  href,
  variant = "primary",
  size = "md",
  block = false,
  className = "",
  icon,
  children,
}: {
  href: string;
  variant?: Variant;
  size?: Size;
  block?: boolean;
  className?: string;
  icon?: IconName;
  children: ReactNode;
}) {
  return (
    <Link href={href} className={buttonClass({ variant, size, block, className })}>
      {icon && <Icon name={icon} size={size === "sm" ? 16 : 18} />}
      {children}
    </Link>
  );
}

/* ---------- Feedback ---------- */

const NOTICE_ICON: Record<"error" | "ok" | "warn" | "info", IconName> = {
  error: "alert",
  ok: "check",
  warn: "alert",
  info: "info",
};

export function Notice({
  kind,
  children,
  className = "",
}: {
  kind: "error" | "ok" | "warn" | "info";
  children: ReactNode;
  className?: string;
}) {
  return (
    <div role={kind === "error" ? "alert" : undefined} className={cx("notice", `notice-${kind}`, className)}>
      <Icon name={NOTICE_ICON[kind]} size={18} className="mt-0.5" />
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  );
}

export type BadgeTone = "neutral" | "brand" | "success" | "warning" | "danger" | "info";

export function Badge({
  tone = "neutral",
  children,
  className = "",
}: {
  tone?: BadgeTone;
  children: ReactNode;
  className?: string;
}) {
  return <span className={cx("badge", `badge-${tone}`, className)}>{children}</span>;
}

/* ---------- Navigation ---------- */

/** Segmented tab link (use inside <nav className="tabs ..."> with a grid-cols class). */
export function TabLink({
  href,
  active,
  icon,
  children,
  className = "",
}: {
  href: string;
  active: boolean;
  icon?: IconName;
  children: ReactNode;
  className?: string;
}) {
  return (
    <Link href={href} aria-current={active ? "page" : undefined} className={cx("tab", className)}>
      {icon && <Icon name={icon} size={18} />}
      <span className="max-w-full truncate">{children}</span>
    </Link>
  );
}

/** Full-screen message used by the offline, error and not-found pages. */
export function StatusScreen({
  icon,
  title,
  children,
  actions,
}: {
  icon: IconName;
  title: string;
  children?: ReactNode;
  actions: ReactNode;
}) {
  return (
    <main className="flex min-h-dvh flex-col items-center justify-center gap-4 bg-ink-50 px-6 py-10 text-center">
      <span className="flex h-16 w-16 items-center justify-center rounded-full bg-brand-100 text-brand-800">
        <Icon name={icon} size={32} />
      </span>
      <h1 className="text-title font-bold tracking-tight">{title}</h1>
      <div className="max-w-xs space-y-2 text-ink-600">{children}</div>
      <div className="flex flex-wrap justify-center gap-2">{actions}</div>
    </main>
  );
}
