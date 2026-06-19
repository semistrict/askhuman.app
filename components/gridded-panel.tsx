import type { ReactNode } from "react";

export function GriddedPanelBackdrop() {
  return (
    <>
      <div
        aria-hidden="true"
        className="absolute inset-0 bg-[linear-gradient(90deg,var(--border)_1px,transparent_1px),linear-gradient(0deg,var(--border)_1px,transparent_1px)] bg-[size:32px_32px] opacity-[0.08]"
      />
      <div
        aria-hidden="true"
        className="absolute left-5 top-5 h-12 w-12 border border-[var(--border)] bg-[var(--accent)] shadow-[4px_4px_0_var(--hard-shadow)]"
      />
    </>
  );
}

export function GriddedPanelBadge({ children }: { children: ReactNode }) {
  return (
    <p className="absolute right-5 top-5 border border-[var(--border)] bg-[var(--background)] px-3 py-2 font-mono text-[11px] uppercase text-[var(--muted-foreground)] shadow-[3px_3px_0_var(--hard-shadow)]">
      {children}
    </p>
  );
}
