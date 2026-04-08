export const APP_SETTINGS_STORAGE_KEY = "askhuman.settings";
export const APP_SETTINGS_CHANGED_EVENT = "askhuman:settings-changed";
export const APP_SETTINGS_OPEN_EVENT = "askhuman:settings-open";

export type AppSettings = {
  enablePostHogMonitoring: boolean;
};

export const DEFAULT_APP_SETTINGS: AppSettings = {
  enablePostHogMonitoring: false,
};

export function parseAppSettings(raw: string | null | undefined): AppSettings {
  if (!raw) return DEFAULT_APP_SETTINGS;

  try {
    const parsed = JSON.parse(raw) as Partial<AppSettings> | null;
    return {
      enablePostHogMonitoring: parsed?.enablePostHogMonitoring === true,
    };
  } catch {
    return DEFAULT_APP_SETTINGS;
  }
}

export function readAppSettings(storage: Pick<Storage, "getItem">): AppSettings {
  return parseAppSettings(storage.getItem(APP_SETTINGS_STORAGE_KEY));
}

export function writeAppSettings(
  storage: Pick<Storage, "setItem">,
  settings: AppSettings
): void {
  storage.setItem(APP_SETTINGS_STORAGE_KEY, JSON.stringify(settings));
}
