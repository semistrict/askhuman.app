"use client";

import { useEffect, useMemo, useState } from "react";
import { Badge } from "@/components/ui/badge";
import {
  APP_SETTINGS_CHANGED_EVENT,
  APP_SETTINGS_STORAGE_KEY,
  ensureReviewerPresenceName,
  openAppSettings,
} from "@/lib/app-settings";
import { SESSION_PRESENCE_EVENT } from "@/lib/debug-tab-client";

type ConnectedTab = {
  tabId: string;
  reviewerName: string | null;
  connected: boolean;
};

interface HumanPresenceBadgeProps {
  sessionId: string;
}

function normalizeNames(tabs: ConnectedTab[]): string[] {
  return Array.from(
    new Set(
      tabs
        .filter((tab) => tab.connected !== false)
        .map((tab) => tab.reviewerName?.trim())
        .filter((name): name is string => Boolean(name))
    )
  );
}

function getNameHash(name: string): number {
  let hash = 0;
  for (let index = 0; index < name.length; index += 1) {
    hash = (hash * 31 + name.charCodeAt(index)) >>> 0;
  }
  return hash;
}

function getPresenceColors(name: string) {
  const hash = getNameHash(name);
  const hue = hash % 360;
  const saturation = 62 + (hash % 14);
  const lightness = 58 + (hash % 8);
  return {
    borderColor: `hsla(${hue}, ${saturation}%, ${lightness}%, 0.42)`,
    backgroundColor: `hsla(${hue}, ${saturation}%, ${lightness}%, 0.14)`,
    color: `hsl(${hue}, ${Math.min(92, saturation + 14)}%, 84%)`,
    boxShadow: `inset 0 0 0 1px hsla(${hue}, ${saturation}%, ${lightness}%, 0.12)`,
  };
}

function sortNames(names: string[], currentName: string | null): string[] {
  return [...names].sort((left, right) => {
    if (currentName && left === currentName && right !== currentName) return -1;
    if (currentName && right === currentName && left !== currentName) return 1;
    return left.localeCompare(right);
  });
}

export function HumanPresenceBadge({ sessionId }: HumanPresenceBadgeProps) {
  const [serverNames, setServerNames] = useState<string[]>([]);
  const [currentName, setCurrentName] = useState<string | null>(null);

  useEffect(() => {
    const syncCurrentName = () => {
      setCurrentName(ensureReviewerPresenceName(window.localStorage));
    };

    syncCurrentName();

    const onSettingsChanged = () => syncCurrentName();
    const onStorage = (event: StorageEvent) => {
      if (event.key == null || event.key === APP_SETTINGS_STORAGE_KEY) {
        syncCurrentName();
      }
    };

    window.addEventListener(APP_SETTINGS_CHANGED_EVENT, onSettingsChanged);
    window.addEventListener("storage", onStorage);
    return () => {
      window.removeEventListener(APP_SETTINGS_CHANGED_EVENT, onSettingsChanged);
      window.removeEventListener("storage", onStorage);
    };
  }, []);

  useEffect(() => {
    const refresh = async () => {
      try {
        const response = await fetch(`/s/${sessionId}/debug/tabs`, {
          cache: "no-store",
          headers: {
            Accept: "application/json",
          },
        });
        if (!response.ok) return;
        const payload = (await response.json()) as { tabs?: ConnectedTab[] };
        setServerNames(normalizeNames(payload.tabs ?? []));
      } catch {
        setServerNames([]);
      }
    };

    const onPresence = (event: Event) => {
      const detail = (event as CustomEvent<{ tabs?: ConnectedTab[] }>).detail;
      setServerNames(normalizeNames(detail?.tabs ?? []));
    };

    void refresh();
    window.addEventListener(SESSION_PRESENCE_EVENT, onPresence);

    return () => {
      window.removeEventListener(SESSION_PRESENCE_EVENT, onPresence);
    };
  }, [sessionId]);

  const names = useMemo(() => {
    const merged = new Set(serverNames);
    if (currentName?.trim()) {
      merged.add(currentName.trim());
    }

    const sorted = sortNames([...merged], currentName?.trim() || null);
    if (sorted.length > 0) return sorted;
    return ["You"];
  }, [currentName, serverNames]);

  return (
    <div className="flex max-w-[28rem] flex-wrap items-center justify-end gap-2">
      {names.map((name) => {
        const isCurrentUser = currentName?.trim() === name;
        const colors = name === "You" ? undefined : getPresenceColors(name);
        return (
          <Badge asChild variant="outline" key={name}>
            <button
              type="button"
              title={
                isCurrentUser
                  ? `${name}. Click to edit your name.`
                  : `${name}. Click to open settings.`
              }
              aria-label={isCurrentUser ? `Your name: ${name}` : `Connected human: ${name}`}
              data-current-user={isCurrentUser ? "true" : "false"}
              onClick={() => openAppSettings(window)}
              className="cursor-pointer gap-2 overflow-hidden font-mono text-[11px] hover:brightness-110"
              style={colors}
            >
              <span
                aria-hidden="true"
                className="h-1.5 w-1.5 shrink-0 rounded-full bg-current opacity-80"
              />
              <span className="truncate">
                {name}
                {isCurrentUser ? " (you)" : ""}
              </span>
            </button>
          </Badge>
        );
      })}
    </div>
  );
}
