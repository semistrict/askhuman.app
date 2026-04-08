"use client";

import { HomeSettingsLink } from "@/components/home-settings-link";

function CopyCard({
  label,
  command,
}: {
  label: string;
  command: string;
}) {
  return (
    <button
      type="button"
      className="group relative mb-3 rounded-md border border-[#2a2724] bg-[#1a1816] px-5 py-4 text-left transition-colors hover:border-[#4a4540]"
      onClick={() => navigator.clipboard.writeText(command)}
    >
      <div className="mb-1.5 font-mono text-[11px] uppercase tracking-[0.05em] text-[#6b6560]">
        {label}
      </div>
      <pre className="overflow-x-auto whitespace-pre-wrap break-all font-mono text-[13px] leading-6 text-[#b0aca6]">
        {command}
      </pre>
      <span className="pointer-events-none absolute top-3 right-3 font-mono text-[11px] text-[#6b6560] opacity-0 transition-opacity group-hover:opacity-100">
        copy
      </span>
    </button>
  );
}

export function HomePageContent() {
  return (
    <main className="min-h-screen bg-[#0c0c0c] px-8 py-12 text-[#b0aca6]">
      <div className="mx-auto flex min-h-[calc(100vh-6rem)] max-w-[560px] flex-col justify-center">
        <h1 className="mb-6 font-mono text-5xl tracking-[-0.04em] text-[#e8e4e0]">
          askhuman<span className="font-normal text-[#6b6560]">.app</span>
        </h1>

        <CopyCard
          label="Install skill"
          command="npx skills add semistrict/askhuman.app"
        />

        <div className="my-4 flex items-center gap-4 font-mono text-[11px] text-[#4a4540]">
          <div className="h-px flex-1 bg-[#2a2724]" />
          <span>or</span>
          <div className="h-px flex-1 bg-[#2a2724]" />
        </div>

        <CopyCard
          label="Prompt-inject yourself"
          command={'claude "$(curl -s https://askhuman.app) -- review my current diff"'}
        />

        <p className="mt-2 mb-5 font-mono text-[11px] text-[#6b6560]">
          Works with any agent that accepts a prompt string.
        </p>

        <div className="mt-6 flex gap-5 border-t border-[#2a2724] pt-5 font-mono text-xs">
          <a
            href="https://github.com/semistrict/askhuman.app"
            className="text-[#8a8580] underline underline-offset-2 transition-colors hover:text-[#e8e4e0]"
          >
            github
          </a>
          <HomeSettingsLink />
          <a
            href="/llms.txt"
            className="text-[#8a8580] underline underline-offset-2 transition-colors hover:text-[#e8e4e0]"
          >
            llms.txt
          </a>
        </div>
      </div>
    </main>
  );
}
