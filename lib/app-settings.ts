export const APP_SETTINGS_STORAGE_KEY = "askhuman.settings";
export const APP_SETTINGS_CHANGED_EVENT = "askhuman:settings-changed";
export const APP_SETTINGS_OPEN_EVENT = "askhuman:settings-open";
export const APP_SETTINGS_HASH = "#settings";

export type AppSettings = {
  enablePostHogMonitoring: boolean;
  userName: string;
  generatedUserName: string;
};

export const DEFAULT_APP_SETTINGS: AppSettings = {
  enablePostHogMonitoring: false,
  userName: "",
  generatedUserName: "",
};

const ODD_FIRST_NAMES = [
  "Bongo",
  "Mopsy",
  "Quibble",
  "Pogo",
  "Doodle",
  "Waffle",
  "Ziggy",
  "Tinsel",
  "Cricket",
  "Nimbus",
  "Pickle",
  "Flump",
];

const ODD_LAST_NAMES = [
  "Fizzlebottom",
  "Wobblewink",
  "Crumblepatch",
  "Snorkelby",
  "Jinglepuff",
  "Picklethorpe",
  "McSprocket",
  "Quackenbush",
  "Wibbleworth",
  "Bumblewhistle",
  "Noodleworth",
  "Cranklepot",
];

export function generateFakeReviewerName(random: () => number = Math.random): string {
  const first = ODD_FIRST_NAMES[Math.floor(random() * ODD_FIRST_NAMES.length)] ?? "Bongo";
  const last = ODD_LAST_NAMES[Math.floor(random() * ODD_LAST_NAMES.length)] ?? "Fizzlebottom";
  return `${first} ${last}`;
}

export function parseAppSettings(raw: string | null | undefined): AppSettings {
  if (!raw) return DEFAULT_APP_SETTINGS;

  try {
    const parsed = JSON.parse(raw) as Partial<AppSettings> | null;
    return {
      enablePostHogMonitoring: parsed?.enablePostHogMonitoring === true,
      userName: typeof parsed?.userName === "string" ? parsed.userName : "",
      generatedUserName:
        typeof parsed?.generatedUserName === "string" ? parsed.generatedUserName : "",
    };
  } catch (error) {
    console.error("Failed to parse app settings", error);
    return DEFAULT_APP_SETTINGS;
  }
}

export function readAppSettings(storage: Pick<Storage, "getItem">): AppSettings {
  try {
    return parseAppSettings(storage.getItem(APP_SETTINGS_STORAGE_KEY));
  } catch (error) {
    console.error("Failed to read app settings from storage", error);
    return DEFAULT_APP_SETTINGS;
  }
}

export function writeAppSettings(
  storage: Pick<Storage, "setItem">,
  settings: AppSettings
): void {
  try {
    storage.setItem(APP_SETTINGS_STORAGE_KEY, JSON.stringify(settings));
  } catch (error) {
    console.error("Failed to write app settings to storage", error);
  }
}

export function getBrowserStorage(target: Window = window): Storage | null {
  try {
    return target.localStorage;
  } catch (error) {
    console.error("Failed to access browser localStorage", error);
    return null;
  }
}

export function openAppSettings(target: Window = window): void {
  if (target.location.hash !== APP_SETTINGS_HASH) {
    target.location.hash = APP_SETTINGS_HASH;
  }
  target.dispatchEvent(new Event(APP_SETTINGS_OPEN_EVENT));
}

export function getEffectiveReviewerName(settings: AppSettings): string {
  return settings.userName.trim() || settings.generatedUserName.trim();
}

export function ensureReviewerPresenceName(
  storage: Pick<Storage, "getItem" | "setItem">,
  random: () => number = Math.random
): string {
  const settings = readAppSettings(storage);
  const explicitName = settings.userName.trim();
  if (explicitName) return explicitName;

  const generatedName = settings.generatedUserName.trim();
  if (generatedName) return generatedName;

  const next = {
    ...settings,
    generatedUserName: generateFakeReviewerName(random),
  };
  writeAppSettings(storage, next);
  return next.generatedUserName;
}
