import type { SVGProps } from "react";

/**
 * The one icon set. 24px grid, 1.75 stroke, round caps, `currentColor`, decorative (aria-hidden).
 * Works in server and client components. Usage: <Icon name="home" /> (size follows `size`, default 20).
 */
const PATHS = {
  home: (
    <>
      <path d="M3.5 11.2 12 4l8.5 7.2" />
      <path d="M5.5 9.7V20h13V9.7" />
      <path d="M10 20v-5.5h4V20" />
    </>
  ),
  mail: (
    <>
      <rect x="3" y="5" width="18" height="14" rx="2.5" />
      <path d="m4 7.5 8 5.5 8-5.5" />
    </>
  ),
  user: (
    <>
      <circle cx="12" cy="8" r="3.6" />
      <path d="M4.8 20c.6-3.6 3.4-5.6 7.2-5.6s6.6 2 7.2 5.6" />
    </>
  ),
  users: (
    <>
      <circle cx="9" cy="8.5" r="3.2" />
      <path d="M3 19.5c.5-3.2 2.9-5 6-5s5.5 1.8 6 5" />
      <path d="M15.5 5.6a3.2 3.2 0 0 1 0 5.8" />
      <path d="M17.5 14.7c1.9.5 3.1 2 3.5 4.8" />
    </>
  ),
  logout: (
    <>
      <path d="M10 4.5H6.5A1.5 1.5 0 0 0 5 6v12a1.5 1.5 0 0 0 1.5 1.5H10" />
      <path d="M15 8l4 4-4 4" />
      <path d="M19 12H9.5" />
    </>
  ),
  layers: (
    <>
      <path d="m12 3.5 8.5 4.3L12 12 3.5 7.8 12 3.5Z" />
      <path d="m3.5 12 8.5 4.2 8.5-4.2" />
      <path d="m3.5 16.2 8.5 4.3 8.5-4.3" />
    </>
  ),
  clipboard: (
    <>
      <rect x="5" y="4.5" width="14" height="16.5" rx="2.5" />
      <path d="M9 4.5h6v2.2a.8.8 0 0 1-.8.8H9.8a.8.8 0 0 1-.8-.8V4.5Z" />
      <path d="M8.8 12h6.4M8.8 15.8h4" />
    </>
  ),
  chart: (
    <>
      <path d="M4 20h16" />
      <rect x="5.5" y="11" width="3" height="6.5" rx="0.8" />
      <rect x="10.5" y="6" width="3" height="11.5" rx="0.8" />
      <rect x="15.5" y="13" width="3" height="4.5" rx="0.8" />
    </>
  ),
  megaphone: (
    <>
      <path d="M4 10v4a1 1 0 0 0 1 1h2.5l7.5 4V5L7.5 9H5a1 1 0 0 0-1 1Z" />
      <path d="M18.5 9.5a3.5 3.5 0 0 1 0 5" />
      <path d="M8 15l1.2 4.2" />
    </>
  ),
  download: (
    <>
      <path d="M12 4v11" />
      <path d="m7.5 11 4.5 4.5 4.5-4.5" />
      <path d="M5 19.5h14" />
    </>
  ),
  upload: (
    <>
      <path d="M12 16V5" />
      <path d="M7.5 9 12 4.5 16.5 9" />
      <path d="M5 19.5h14" />
    </>
  ),
  scissors: (
    <>
      <circle cx="6.5" cy="6.8" r="2.6" />
      <circle cx="6.5" cy="17.2" r="2.6" />
      <path d="M8.5 8.6 20 18M8.5 15.4 20 6" />
    </>
  ),
  alert: (
    <>
      <path d="M12 4.2 21 19.5H3L12 4.2Z" />
      <path d="M12 10v4.2" />
      <path d="M12 16.9v.1" />
    </>
  ),
  check: <path d="m5 12.8 4.4 4.4L19 7.4" />,
  x: <path d="M6 6l12 12M18 6 6 18" />,
  plus: <path d="M12 5v14M5 12h14" />,
  camera: (
    <>
      <path d="M4 8.5A1.5 1.5 0 0 1 5.5 7h2.2l1.2-2h6.2l1.2 2h2.2A1.5 1.5 0 0 1 20 8.5v9A1.5 1.5 0 0 1 18.5 19h-13A1.5 1.5 0 0 1 4 17.5v-9Z" />
      <circle cx="12" cy="13" r="3.4" />
    </>
  ),
  clock: (
    <>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M12 7.5V12l3 2" />
    </>
  ),
  "arrow-left": (
    <>
      <path d="M19 12H5" />
      <path d="m11 6-6 6 6 6" />
    </>
  ),
  "arrow-right": (
    <>
      <path d="M5 12h14" />
      <path d="m13 6 6 6-6 6" />
    </>
  ),
  "chevron-right": <path d="m9 5.5 6.5 6.5L9 18.5" />,
  "chevron-down": <path d="m5.5 9 6.5 6.5L18.5 9" />,
  info: (
    <>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M12 11v5" />
      <path d="M12 7.9v.1" />
    </>
  ),
  refresh: (
    <>
      <path d="M19.5 12a7.5 7.5 0 0 1-13 5.1" />
      <path d="M4.5 12a7.5 7.5 0 0 1 13-5.1" />
      <path d="M17.5 3.5v3.8h-3.8" />
      <path d="M6.5 20.5v-3.8h3.8" />
    </>
  ),
  pencil: (
    <>
      <path d="M4.5 19.5 5.3 15 15.8 4.5a1.8 1.8 0 0 1 2.5 0l1.2 1.2a1.8 1.8 0 0 1 0 2.5L9 18.7l-4.5.8Z" />
      <path d="m13.8 6.5 3.7 3.7" />
    </>
  ),
  copy: (
    <>
      <rect x="8.5" y="8.5" width="11" height="11" rx="2" />
      <path d="M15.5 8.5V6.5a2 2 0 0 0-2-2h-7a2 2 0 0 0-2 2v7a2 2 0 0 0 2 2h2" />
    </>
  ),
  trash: (
    <>
      <path d="M4.5 7h15" />
      <path d="M9.5 7V4.8h5V7" />
      <path d="M6.5 7l.9 12a1.5 1.5 0 0 0 1.5 1.4h6.2a1.5 1.5 0 0 0 1.5-1.4L17.5 7" />
    </>
  ),
  eye: (
    <>
      <path d="M2.8 12S6 5.8 12 5.8 21.2 12 21.2 12 18 18.2 12 18.2 2.8 12 2.8 12Z" />
      <circle cx="12" cy="12" r="2.8" />
    </>
  ),
  send: (
    <>
      <path d="M20.5 3.5 10.2 13.8" />
      <path d="M20.5 3.5 14 20.5l-3.8-6.7L3.5 10l17-6.5Z" />
    </>
  ),
  "arrow-up": (
    <>
      <path d="M12 19V5" />
      <path d="m6 11 6-6 6 6" />
    </>
  ),
  "arrow-down": (
    <>
      <path d="M12 5v14" />
      <path d="m6 13 6 6 6-6" />
    </>
  ),
  file: (
    <>
      <path d="M6.5 3.5h7L18.5 8.5v11a1 1 0 0 1-1 1h-11a1 1 0 0 1-1-1v-15a1 1 0 0 1 1-1Z" />
      <path d="M13.5 3.5v5h5" />
    </>
  ),
  lock: (
    <>
      <rect x="5" y="10.5" width="14" height="9.5" rx="2.2" />
      <path d="M8.5 10.5V8a3.5 3.5 0 0 1 7 0v2.5" />
    </>
  ),
  radio: (
    <>
      <circle cx="12" cy="12" r="2.2" />
      <path d="M7.6 7.6a6.2 6.2 0 0 0 0 8.8M16.4 7.6a6.2 6.2 0 0 1 0 8.8" />
      <path d="M4.8 4.8a10.2 10.2 0 0 0 0 14.4M19.2 4.8a10.2 10.2 0 0 1 0 14.4" />
    </>
  ),
  "wifi-off": (
    <>
      <path d="M3.5 3.5 20.5 20.5" />
      <path d="M8.6 16.4a5 5 0 0 1 4.4-1.3" />
      <path d="M5 12.6a9.6 9.6 0 0 1 3.3-2.1" />
      <path d="M15.6 10.3a9.6 9.6 0 0 1 3.4 2.3" />
      <path d="M2.5 9a14 14 0 0 1 3.4-2.2" />
      <path d="M10 5.2A14 14 0 0 1 21.5 9" />
      <path d="M12 19.5v.1" />
    </>
  ),
} as const;

export type IconName = keyof typeof PATHS;

export function Icon({
  name,
  size = 20,
  className = "",
  ...props
}: { name: IconName; size?: number } & Omit<SVGProps<SVGSVGElement>, "name">) {
  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill="none"
      stroke="currentColor"
      strokeWidth={1.75}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      className={`shrink-0 ${className}`}
      {...props}
    >
      {PATHS[name]}
    </svg>
  );
}

/** The official OLFU College of Business Administration seal (public/logo*.png). Decorative. */
export function LogoMark({ size = 32, className = "" }: { size?: number; className?: string }) {
  const src = size > 56 ? "/logo.png" : "/logo-128.png";
  return (
    // eslint-disable-next-line @next/next/no-img-element -- a small static seal; nothing to optimize
    <img src={src} width={size} height={size} alt="" className={`shrink-0 rounded-full bg-white ring-2 ring-white/70 ${className}`} />
  );
}
