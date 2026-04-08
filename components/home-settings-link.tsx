"use client";

import { APP_SETTINGS_OPEN_EVENT } from "@/lib/app-settings";

export function HomeSettingsLink() {
  return (
    <a
      href="#settings"
      className="text-[#8a8580] underline underline-offset-2 transition-colors hover:text-[#e8e4e0]"
      onClick={(event) => {
        event.preventDefault();
        window.dispatchEvent(new Event(APP_SETTINGS_OPEN_EVENT));
      }}
    >
      settings
    </a>
  );
}
