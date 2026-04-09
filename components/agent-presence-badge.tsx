"use client";

import { useEffect, useState } from "react";
import { Badge } from "@/components/ui/badge";

type ConnectedAgent = {
  agentId: string;
  connected: boolean;
};

interface AgentPresenceBadgeProps {
  sessionId: string;
}

const REFRESH_MS = 2000;

export function AgentPresenceBadge({ sessionId }: AgentPresenceBadgeProps) {
  const [connectedCount, setConnectedCount] = useState(0);

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;

    async function refresh() {
      try {
        const response = await fetch(`/s/${sessionId}/debug/agents`, {
          cache: "no-store",
          headers: {
            Accept: "application/json",
          },
        });
        if (!response.ok) return;
        const payload = (await response.json()) as { agents?: ConnectedAgent[] };
        if (cancelled) return;
        const count = (payload.agents ?? []).filter((agent) => agent.connected !== false).length;
        setConnectedCount(count);
      } catch {
        if (!cancelled) {
          setConnectedCount(0);
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

  const isConnected = connectedCount > 0;

  return (
    <Badge
      variant="outline"
      className={
        isConnected
          ? "gap-2 border-emerald-500/40 bg-emerald-500/10 font-mono text-[11px] text-emerald-200"
          : "gap-2 border-border/80 bg-muted/30 font-mono text-[11px] text-muted-foreground"
      }
    >
      <span
        aria-hidden="true"
        className={
          isConnected
            ? "h-1.5 w-1.5 rounded-full bg-emerald-400 shadow-[0_0_0_4px_rgba(74,222,128,0.16)] animate-pulse"
            : "h-1.5 w-1.5 rounded-full bg-muted-foreground/60"
        }
      />
      {isConnected
        ? connectedCount === 1
          ? "Agent polling"
          : `${connectedCount} agents polling`
        : "Agent idle"}
    </Badge>
  );
}
