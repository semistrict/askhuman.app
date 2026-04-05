export default function Home() {
  return (
    <div className="flex flex-1 items-center justify-center px-6">
      <div className="max-w-xl w-full font-mono space-y-10">
        <div>
          <h1 className="text-4xl sm:text-5xl font-bold tracking-tighter">
            askhuman
            <span className="text-muted-foreground font-normal">.app</span>
          </h1>
          <p className="text-muted-foreground mt-2">
            Human-in-the-loop review tools for AI agents.
          </p>
        </div>

        <div className="space-y-4 text-sm">
          <div>
            <div className="text-muted-foreground text-xs mb-1">Claude Code</div>
            <pre className="text-foreground">{`/plugin marketplace add semistrict/askhuman.app
/plugin install askhuman.app@askhuman`}</pre>
          </div>
          <div>
            <div className="text-muted-foreground text-xs mb-1">Codex</div>
            <pre className="text-foreground">{`codex mcp add askhuman --url https://askhuman.app/mcp`}</pre>
          </div>
          <div>
            <div className="text-muted-foreground text-xs mb-1">
              Any agent
            </div>
            <pre className="text-foreground">curl https://askhuman.app</pre>
          </div>
        </div>

        <div className="text-xs text-muted-foreground flex gap-4">
          <a
            href="https://github.com/semistrict/askhuman.app"
            className="hover:text-foreground transition-colors underline underline-offset-2"
          >
            github
          </a>
          <a
            href="/llms.txt"
            className="hover:text-foreground transition-colors underline underline-offset-2"
          >
            llms.txt
          </a>
        </div>
      </div>
    </div>
  );
}
