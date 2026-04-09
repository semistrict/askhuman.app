import { describe, expect, it } from "vitest";
import {
  APP_SETTINGS_STORAGE_KEY,
  DEFAULT_APP_SETTINGS,
  ensureReviewerPresenceName,
  generateFakeReviewerName,
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
        return JSON.stringify({ enablePostHogMonitoring: true, userName: "Ramon" });
      },
    };

    expect(readAppSettings(storage)).toEqual({
      enablePostHogMonitoring: true,
      userName: "Ramon",
      generatedUserName: "",
    });
  });

  it("writes the expected localStorage payload", () => {
    const writes: Array<{ key: string; value: string }> = [];
    const storage = {
      setItem(key: string, value: string) {
        writes.push({ key, value });
      },
    };

    writeAppSettings(storage, {
      enablePostHogMonitoring: true,
      userName: "Ramon",
      generatedUserName: "",
    });

    expect(writes).toEqual([
      {
        key: APP_SETTINGS_STORAGE_KEY,
        value: JSON.stringify({
          enablePostHogMonitoring: true,
          userName: "Ramon",
          generatedUserName: "",
        }),
      },
    ]);
  });

  it("generates and persists a fake reviewer alias when no explicit name is set", () => {
    let storedValue: string | null = null;
    const storage = {
      getItem(key: string) {
        expect(key).toBe(APP_SETTINGS_STORAGE_KEY);
        return storedValue;
      },
      setItem(key: string, value: string) {
        expect(key).toBe(APP_SETTINGS_STORAGE_KEY);
        storedValue = value;
      },
    };

    const alias = ensureReviewerPresenceName(storage, () => 0);
    expect(alias).toBe("Bongo Fizzlebottom");
    expect(storedValue).toBe(
      JSON.stringify({
        enablePostHogMonitoring: false,
        userName: "",
        generatedUserName: "Bongo Fizzlebottom",
      })
    );
  });

  it("returns the stored explicit name instead of generating an alias", () => {
    const storage = {
      getItem(key: string) {
        expect(key).toBe(APP_SETTINGS_STORAGE_KEY);
        return JSON.stringify({
          enablePostHogMonitoring: false,
          userName: "Ramon",
          generatedUserName: "Bongo Fizzlebottom",
        });
      },
      setItem() {
        throw new Error("should not overwrite existing explicit name");
      },
    };

    expect(ensureReviewerPresenceName(storage, () => 0.5)).toBe("Ramon");
  });

  it("can generate obviously fake reviewer names", () => {
    expect(generateFakeReviewerName(() => 0)).toBe("Bongo Fizzlebottom");
  });
});
