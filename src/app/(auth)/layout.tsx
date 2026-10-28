import type { ReactNode } from "react";
import { LogoMark } from "@/components/icons";

export default function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-dvh flex-col bg-ink-50">
      <div className="bg-brand-800 px-4 pb-16 pt-9 text-center text-white">
        <LogoMark size={56} tone="light" className="mx-auto" />
        <h1 className="mt-3 text-3xl font-bold tracking-tight">Accounthink</h1>
        <p className="mt-1 text-xs font-semibold uppercase tracking-wide text-brand-100">
          Our Lady of Fatima University · CBA
        </p>
      </div>
      <main className="-mt-10 flex flex-1 justify-center px-4 pb-10">
        <div className="card h-fit w-full max-w-sm !p-5 shadow-raised sm:!p-6">{children}</div>
      </main>
    </div>
  );
}
