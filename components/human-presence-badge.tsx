"use client";

import { useEffect, useState } from "react";
import { Badge } from "@/components/ui/badge";

type ConnectedTab = {
  tabId: string;
  reviewerName: string | null;
  connected: boolean;
};

interface HumanPresenceBadgeProps {
  sessionId: string;
}

const REFRESH_MS = 2000;

function summarizeNames(names: string[]): string {
  if (names.length === 0) return "Humans: none";
  if (names.length === 1) return `Human: ${names[0]}`;
  if (names.length === 2) return `Humans: ${names[0]}, ${names[1]}`;
  return `Humans: ${names[0]}, ${names[1]} +${names.length - 2}`;
}

export function HumanPresenceBadge({ sessionId }: HumanPresenceBadgeProps) {
  const [names, setNames] = useState<string[]>([]);

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;

    async function refresh() {
      try {
        const response = await fetch(`/s/${sessionId}/debug/tabs`, {
          cache: "no-store",
          headers: {
            Accept: "application/json",
          },
        });
        if (!response.ok) return;
        const payload = (await response.json()) as { tabs?: ConnectedTab[] };
        if (cancelled) return;
        const nextNames = Array.from(
          new Set(
            (payload.tabs ?? [])
              .filter((tab) => tab.connected !== false)
              .map((tab) => tab.reviewerName?.trim())
              .filter((name): name is string => Boolean(name))
          )
        );
        setNames(nextNames);
      } catch {
        if (!cancelled) {
          setNames([]);
        }
      } finally {
        if (!cancelled) {
          timer = setTimeout(refresh, REFRESH_MS);
        }
      }
    }

    void refresh();

    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [sessionId]);

  return (
    <Badge
      variant="outline"
      title={names.length > 0 ? names.join(", ") : "No connected humans"}
      className={
        names.length > 0
          ? "max-w-[22rem] gap-2 overflow-hidden border-sky-500/35 bg-sky-500/10 font-mono text-[11px] text-sky-200"
          : "gap-2 border-border/80 bg-muted/30 font-mono text-[11px] text-muted-foreground"
      }
    >
      <span
        aria-hidden="true"
        className={
          names.length > 0
            ? "h-1.5 w-1.5 shrink-0 rounded-full bg-sky-400 shadow-[0_0_0_4px_rgba(56,189,248,0.12)]"
            : "h-1.5 w-1.5 shrink-0 rounded-full bg-muted-foreground/60"
        }
      />
      <span className="truncate">{summarizeNames(names)}</span>
    </Badge>
  );
}
