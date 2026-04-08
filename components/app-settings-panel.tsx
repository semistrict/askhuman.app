"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  APP_SETTINGS_CHANGED_EVENT,
  APP_SETTINGS_OPEN_EVENT,
  APP_SETTINGS_STORAGE_KEY,
  DEFAULT_APP_SETTINGS,
  readAppSettings,
  writeAppSettings,
  type AppSettings,
} from "@/lib/app-settings";

const POSTHOG_API_KEY =
  process.env.NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN ??
  process.env.NEXT_PUBLIC_POSTHOG_KEY ??
  "";
const POSTHOG_API_HOST = process.env.NEXT_PUBLIC_POSTHOG_HOST ?? "https://us.i.posthog.com";
const POSTHOG_SCRIPT_ID = "askhuman-posthog-script";

type PostHogApi = {
  init: (key: string, config?: Record<string, unknown>) => void;
  opt_in_capturing?: () => void;
  opt_out_capturing?: () => void;
  reset?: () => void;
};

declare global {
  interface Window {
    posthog?: PostHogApi;
    __askhumanPosthogLoadPromise?: Promise<void>;
    __askhumanPosthogInitialized?: boolean;
  }
}

function loadSettings(): AppSettings {
  return readAppSettings(window.localStorage);
}

function saveSettings(next: AppSettings): void {
  writeAppSettings(window.localStorage, next);
  window.dispatchEvent(new Event(APP_SETTINGS_CHANGED_EVENT));
}

function isPostHogConfigured(): boolean {
  return POSTHOG_API_KEY.trim().length > 0;
}

async function ensurePostHogLoaded(): Promise<void> {
  if (!isPostHogConfigured()) return;
  if (window.posthog) return;
  if (window.__askhumanPosthogLoadPromise) {
    await window.__askhumanPosthogLoadPromise;
    return;
  }

  const existing = document.getElementById(POSTHOG_SCRIPT_ID) as HTMLScriptElement | null;
  if (existing) {
    window.__askhumanPosthogLoadPromise = new Promise<void>((resolve, reject) => {
      existing.addEventListener("load", () => resolve(), { once: true });
      existing.addEventListener("error", () => reject(new Error("Failed to load PostHog")), {
        once: true,
      });
    });
    await window.__askhumanPosthogLoadPromise;
    return;
  }

  window.__askhumanPosthogLoadPromise = new Promise<void>((resolve, reject) => {
    const script = document.createElement("script");
    script.id = POSTHOG_SCRIPT_ID;
    script.async = true;
    script.src = `${POSTHOG_API_HOST.replace(/\/$/, "")}/static/array.js`;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error("Failed to load PostHog"));
    document.head.appendChild(script);
  });

  await window.__askhumanPosthogLoadPromise;
}

async function enablePostHog(): Promise<void> {
  if (!isPostHogConfigured()) return;

  await ensurePostHogLoaded();
  if (!window.posthog) return;

  if (!window.__askhumanPosthogInitialized) {
    window.posthog.init(POSTHOG_API_KEY, {
      api_host: POSTHOG_API_HOST,
      capture_pageview: true,
      capture_pageleave: true,
      autocapture: true,
    });
    window.__askhumanPosthogInitialized = true;
  } else {
    window.posthog.opt_in_capturing?.();
  }
}

function disablePostHog(): void {
  window.posthog?.opt_out_capturing?.();
}

export function AppSettingsPanel() {
  const [isOpen, setIsOpen] = useState(false);
  const [isReady, setIsReady] = useState(false);
  const [settings, setSettings] = useState<AppSettings>(DEFAULT_APP_SETTINGS);

  useEffect(() => {
    const sync = () => setSettings(loadSettings());
    sync();
    setIsReady(true);

    const onSettingsChanged = () => sync();
    const onOpen = () => setIsOpen(true);
    const onStorage = (event: StorageEvent) => {
      if (event.key == null || event.key === APP_SETTINGS_STORAGE_KEY) {
        sync();
      }
    };

    window.addEventListener(APP_SETTINGS_CHANGED_EVENT, onSettingsChanged);
    window.addEventListener(APP_SETTINGS_OPEN_EVENT, onOpen);
    window.addEventListener("storage", onStorage);
    return () => {
      window.removeEventListener(APP_SETTINGS_CHANGED_EVENT, onSettingsChanged);
      window.removeEventListener(APP_SETTINGS_OPEN_EVENT, onOpen);
      window.removeEventListener("storage", onStorage);
    };
  }, []);

  useEffect(() => {
    if (!isReady) return;

    if (settings.enablePostHogMonitoring) {
      void enablePostHog();
      return;
    }

    disablePostHog();
  }, [isReady, settings.enablePostHogMonitoring]);

  useEffect(() => {
    if (!isOpen) return;

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setIsOpen(false);
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [isOpen]);

  const updateSettings = (next: AppSettings) => {
    setSettings(next);
    saveSettings(next);
  };

  return (
    <>
      <div className="fixed right-4 bottom-4 z-40">
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="border-border/80 bg-background/90 shadow-sm backdrop-blur"
          onClick={() => setIsOpen(true)}
        >
          Settings
        </Button>
      </div>

      {isOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 px-4 backdrop-blur-md"
          onClick={() => setIsOpen(false)}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="settings-dialog-title"
            className="w-full max-w-md rounded-xl border border-border bg-background/95 p-5 shadow-2xl"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="flex items-start justify-between gap-4">
              <div>
                <h2 id="settings-dialog-title" className="text-lg font-semibold">
                  Settings
                </h2>
                <p className="mt-1 text-sm text-muted-foreground">
                  Stored in this browser with localStorage.
                </p>
              </div>
              <Button type="button" variant="ghost" size="sm" onClick={() => setIsOpen(false)}>
                Close
              </Button>
            </div>

            <div className="mt-5 rounded-lg border border-border bg-card p-4">
              <div className="mb-4 space-y-2">
                <label htmlFor="settings-user-name" className="text-sm font-medium">
                  Your name
                </label>
                <input
                  id="settings-user-name"
                  type="text"
                  value={settings.userName}
                  onChange={(event) =>
                    updateSettings({
                      ...settings,
                      userName: event.target.value,
                    })
                  }
                  placeholder="Optional"
                  className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm outline-none transition-colors focus:border-ring"
                />
                <p className="text-sm text-muted-foreground">
                  Stored locally so the app can refer to you by name later.
                </p>
              </div>

              <label className="flex items-start gap-3">
                <input
                  type="checkbox"
                  className="mt-1 size-4 rounded border-input"
                  checked={settings.enablePostHogMonitoring}
                  onChange={(event) =>
                    updateSettings({
                      ...settings,
                      enablePostHogMonitoring: event.target.checked,
                    })
                  }
                />
                <div className="space-y-1">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium">Enable PostHog monitoring</span>
                    <span className="rounded bg-muted px-2 py-0.5 text-[10px] font-mono uppercase text-muted-foreground">
                      {settings.enablePostHogMonitoring ? "on" : "off"}
                    </span>
                  </div>
                  <p className="text-sm text-muted-foreground">
                    When enabled, PostHog is loaded in this browser and initialized on each page.
                  </p>
                  {!isPostHogConfigured() && (
                    <p className="text-xs text-amber-700 dark:text-amber-300">
                      PostHog is not configured in this environment yet. Add{" "}
                      <code>NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN</code> to activate collection.
                    </p>
                  )}
                </div>
              </label>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
