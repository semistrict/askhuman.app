import { describe, expect, it } from "vitest";
import {
  APP_SETTINGS_STORAGE_KEY,
  DEFAULT_APP_SETTINGS,
  parseAppSettings,
  readAppSettings,
  writeAppSettings,
} from "@/lib/app-settings";

describe("app settings", () => {
  it("defaults PostHog monitoring to disabled", () => {
    expect(parseAppSettings(null)).toEqual(DEFAULT_APP_SETTINGS);
    expect(parseAppSettings("")).toEqual(DEFAULT_APP_SETTINGS);
    expect(parseAppSettings("{")).toEqual(DEFAULT_APP_SETTINGS);
  });

  it("reads a stored enabled setting", () => {
    const storage = {
      getItem(key: string) {
        expect(key).toBe(APP_SETTINGS_STORAGE_KEY);
        return JSON.stringify({ enablePostHogMonitoring: true });
      },
    };

    expect(readAppSettings(storage)).toEqual({ enablePostHogMonitoring: true });
  });

  it("writes the expected localStorage payload", () => {
    const writes: Array<{ key: string; value: string }> = [];
    const storage = {
      setItem(key: string, value: string) {
        writes.push({ key, value });
      },
    };

    writeAppSettings(storage, { enablePostHogMonitoring: true });

    expect(writes).toEqual([
      {
        key: APP_SETTINGS_STORAGE_KEY,
        value: JSON.stringify({ enablePostHogMonitoring: true }),
      },
    ]);
  });
});
