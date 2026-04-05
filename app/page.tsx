export default function Home() {
  return (
    <div className="flex flex-1 items-center justify-center px-6 py-16">
      <div className="max-w-2xl w-full font-mono">
        {/* Hero */}
        <div className="mb-12">
          <div className="text-muted-foreground text-xs mb-3 tracking-widest uppercase">
            v1.0.0
          </div>
          <h1 className="text-4xl sm:text-5xl font-bold tracking-tighter mb-4">
            askhuman
            <span className="text-muted-foreground font-normal">.app</span>
          </h1>
          <p className="text-lg text-muted-foreground leading-relaxed">
            Sometimes your AI agent needs to phone a friend.
            <br />
            <span className="text-foreground">
              Human-in-the-loop review tools for AI agents.
            </span>
          </p>
        </div>

        {/* Usage block styled like a man page */}
        <div className="mb-10 border border-border rounded-lg p-5 bg-card">
          <div className="text-xs text-muted-foreground mb-3 uppercase tracking-wider">
            Synopsis
          </div>
          <div className="text-sm leading-relaxed space-y-1">
            <p>
              <span className="text-muted-foreground">$</span> agent submits
              plan
            </p>
            <p>
              <span className="text-muted-foreground">$</span> human reviews in
              browser, posts comments
            </p>
            <p>
              <span className="text-muted-foreground">$</span> agent reads
              feedback, replies
            </p>
            <p>
              <span className="text-muted-foreground">$</span> loop until human
              returns{" "}
              <span className="text-green-600 dark:text-green-400">
                {"{ status: \"done\" }"}
              </span>
            </p>
          </div>
        </div>

        {/* Interfaces */}
        <div className="mb-10">
          <h2 className="text-xs text-muted-foreground mb-4 uppercase tracking-wider">
            Interfaces
          </h2>
          <div className="grid sm:grid-cols-2 gap-4">
            <div className="border border-border rounded-lg p-4 bg-card">
              <div className="text-sm font-semibold mb-2">MCP</div>
              <code className="text-xs text-muted-foreground block mb-2 break-all">
                https://askhuman.app/mcp
              </code>
              <p className="text-xs text-muted-foreground">
                Streamable HTTP. Works with Claude Code, Codex, and any MCP
                client. Tools: submit_plan, get_comments, reply_to_comments.
              </p>
            </div>
            <div className="border border-border rounded-lg p-4 bg-card">
              <div className="text-sm font-semibold mb-2">REST</div>
              <code className="text-xs text-muted-foreground block mb-2 break-all">
                https://askhuman.app/agent/sessions
              </code>
              <p className="text-xs text-muted-foreground">
                Plain HTTP + JSON. Long-polling. Use curl, fetch, or whatever
                your agent speaks.
              </p>
            </div>
          </div>
        </div>

        {/* Quick start */}
        <div className="mb-10">
          <h2 className="text-xs text-muted-foreground mb-4 uppercase tracking-wider">
            Quick Start
          </h2>
          <div className="space-y-3 text-sm">
            <div className="border border-border rounded-lg p-4 bg-card overflow-x-auto">
              <div className="text-xs text-muted-foreground mb-2">
                Claude Code
              </div>
              <pre className="text-xs whitespace-pre leading-relaxed">{`/plugin marketplace add semistrict/askhuman.app
/plugin install askhuman.app@askhuman`}</pre>
            </div>
            <div className="border border-border rounded-lg p-4 bg-card overflow-x-auto">
              <div className="text-xs text-muted-foreground mb-2">
                Codex
              </div>
              <pre className="text-xs whitespace-pre leading-relaxed">{`codex mcp add askhuman --url https://askhuman.app/mcp`}</pre>
            </div>
            <div className="border border-border rounded-lg p-4 bg-card overflow-x-auto">
              <div className="text-xs text-muted-foreground mb-2">
                curl
              </div>
              <pre className="text-xs whitespace-pre leading-relaxed">{`curl -X POST https://askhuman.app/agent/sessions
# → { "id": "uuid" }

curl -X POST https://askhuman.app/agent/sessions/\${id}/plan \\
  -d '# My Plan...'
# → { "url": "https://askhuman.app/session/uuid", ... }

curl https://askhuman.app/agent/sessions/\${id}/comments
# → blocks until human comments, returns threads`}</pre>
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="border-t border-border pt-6 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
          <div className="text-xs text-muted-foreground">
            Runs on Cloudflare Workers + Durable Objects.
            <br />
            Humans run on coffee, presumably.
          </div>
          <a
            href="https://github.com/semistrict/askhuman.app"
            className="text-xs text-muted-foreground hover:text-foreground transition-colors underline underline-offset-2"
          >
            github
          </a>
        </div>
      </div>
    </div>
  );
}
