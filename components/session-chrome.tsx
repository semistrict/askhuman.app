"use client";

import type { ReactNode } from "react";
import { Badge } from "@/components/ui/badge";
import { AgentPresenceBadge } from "@/components/agent-presence-badge";
import { HumanPresenceBadge } from "@/components/human-presence-badge";

interface SessionChromeProps {
  title: string;
  sessionId: string;
  headerBadges?: ReactNode;
  children: ReactNode;
}

export function SessionChrome({
  title,
  sessionId,
  headerBadges,
  children,
}: SessionChromeProps) {
  return (
    <div className="h-screen bg-background text-foreground flex flex-col">
      <header className="border-b border-border px-6 py-4 shrink-0">
        <div className="flex items-center justify-between gap-4">
          <h1 className="text-lg font-semibold tracking-tight font-mono">
            {title}
          </h1>
          <div className="flex items-center gap-3">
            {headerBadges}
            <HumanPresenceBadge sessionId={sessionId} />
            <AgentPresenceBadge sessionId={sessionId} />
            <Badge variant="outline" className="font-mono text-xs">
              {sessionId.slice(0, 8)}
            </Badge>
          </div>
        </div>
      </header>

      {children}
    </div>
  );
}
