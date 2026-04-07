/**
 * Generate public docs and the unified skill from YAML message sources.
 *
 * Run: node scripts/generate-docs.ts
 *
 * Outputs are committed to the repo so they're always in sync.
 */

import { readFileSync, writeFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { parse } from "yaml";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

function loadYaml(name: string): Record<string, string> {
  const raw = readFileSync(resolve(ROOT, "lib/messages", name), "utf-8");
  return parse(raw) as Record<string, string>;
}

const plan = loadYaml("plan.yaml");
const diff = loadYaml("diff.yaml");
const files = loadYaml("files.yaml");
const playground = loadYaml("playground.yaml");

// ---------------------------------------------------------------------------
// public/llms.txt
// ---------------------------------------------------------------------------

const llmsTxt = `# askhuman.app - Human-in-the-loop review tools for AI agents

> Sometimes your AI agent needs human input from the same user
> it is already interacting with. Submit plans, diffs, files, or
> custom HTML playgrounds via curl. Open the returned URL in that
> user's browser. Poll for their feedback when they click Done.

## Quick Start (curl)

\`\`\`
curl https://askhuman.app
\`\`\`

Detects curl and prints session-specific instructions.

## Tools

### Plan Review

Submit a markdown plan for line-by-line review.

- \`POST /plan\` -- markdown body, returns \`{ sessionId, url, instructions }\`
- \`GET /plan/{id}/poll\` -- long-polls, returns when reviewer clicks Done
- Flow: submit -> open URL -> poll -> address numbered comments

### Diff Review

Submit a unified diff with a description for review.

- \`POST /diff\` -- multipart \`description\` + \`diff\`, returns \`{ sessionId, url, message }\`
- \`POST /diff\` with \`sessionId\` -- resubmit after code changes (resets done, marks changed-hunk comments outdated)
- \`GET /diff/{id}/poll\` -- long-polls, returns when reviewer clicks Done
- Flow: submit -> open URL -> poll -> address comments -> resubmit if needed

### File Review

Submit named files for review with a file selector UI.

- \`POST /files\` -- multipart where field name = file path, value = content
- \`POST /files\` with \`sessionId\` -- re-upload all files (omitted files are removed, their comments marked outdated)
- \`GET /files/{id}/poll\` -- long-polls, returns when reviewer clicks Done
- Flow: submit -> open URL -> poll -> address comments -> re-upload if needed

### Playground

Submit a self-contained HTML page as an interactive UI.

- \`POST /playground\` -- multipart with \`html\` field
- \`POST /playground\` with \`sessionId\` -- update the HTML
- \`GET /playground/{id}/poll\` -- long-polls, returns \`{ status, threads, result }\`
- The HTML sends structured results via \`window.parent.postMessage({ type: 'askhuman:result', data: '...' }, '*')\`
- Flow: submit HTML -> open URL -> human interacts -> clicks Done -> poll returns result + comments

## Common Patterns

All tools share the same interaction pattern:

1. Agent submits content via \`POST\`
2. Agent opens the returned URL for the human reviewer
3. Agent polls with \`GET .../poll\` (long-polls up to 10 min)
4. Human reviews, leaves numbered comments, clicks Done
5. Poll returns with status "done" and all comments
6. Agent addresses each numbered comment
7. If code changes are needed, agent resubmits and loops back to step 3

Poll statuses: \`"done"\` (comments ready), \`"timeout"\` (poll again),
\`"error"\` (human not connected, open the URL).

## Data Model

Threads have optional \`hunk_id\`, \`line\`, and \`file_path\` fields
depending on the tool. Each thread contains messages with \`role\`
("human" or "agent") and \`text\`. Threads may be marked \`outdated\`
when content is resubmitted and the underlying hunk/file changes.
`;

writeFileSync(resolve(ROOT, "public/llms.txt"), llmsTxt);
console.log("wrote public/llms.txt");

// ---------------------------------------------------------------------------
// skills/askhuman/SKILL.md
// ---------------------------------------------------------------------------

const skillMd = `---
name: askhuman
description: >-
  Human-in-the-loop review tools. Submit plans, diffs, files, or
  interactive HTML playgrounds for the same user the agent is already
  interacting with. The user reviews in the browser, leaves numbered
  comments, clicks Done, and the agent polls for feedback.
---

# askhuman.app

Human-in-the-loop review tools for AI agents. Submit content via
curl, open the returned URL for the user, poll for their feedback.

## Rules

- Do **not** use browser automation tools to act as the human.
- Open the review URL in the real user's browser.
- Use \`curl\` on the agent side for all API calls.

## Common Pattern

All four tools follow the same flow:

1. Agent submits content via \`POST\`
2. Agent opens the URL for the user (try Chrome app mode for a
   clean window, fall back to \`open\` / \`xdg-open\`, or show URL)
3. Agent polls with \`GET .../poll\` (long-polls up to 10 min)
4. Human reviews, leaves numbered comments (#1, #2, ...), clicks Done
5. Poll returns status \`"done"\` with all comments
6. Agent addresses each numbered comment
7. If code changes are needed, agent resubmits and loops to step 3

Poll statuses:
- \`"done"\` -- comments ready, address them
- \`"timeout"\` -- no activity, poll again
- \`"error"\` -- user not connected, open the URL

---

## Plan Review

Submit a markdown plan for line-by-line review.

### Submit

\`\`\`bash
curl -s --data-binary @plan.md https://askhuman.app/plan
\`\`\`

### Poll

\`\`\`bash
curl -s https://askhuman.app/plan/<sessionId>/poll
\`\`\`

### Notes

- The response includes the review URL and polling instructions.
- Comments reference line numbers in the markdown.

---

## Diff Review

Submit a unified diff with a narrated description for review.

### Submit

\`\`\`bash
curl -s -X POST https://askhuman.app/diff \\
  -F description=@description.md \\
  -F diff=@current.diff
\`\`\`

### Poll

\`\`\`bash
curl -s https://askhuman.app/diff/<sessionId>/poll
\`\`\`

### Resubmit after code changes

\`\`\`bash
curl -s -X POST https://askhuman.app/diff \\
  -F sessionId=<sessionId> \\
  -F description=@description.md \\
  -F diff=@current.diff
\`\`\`

Comments on changed hunks are automatically marked outdated.

### Description requirements

The description MUST narrate the change. Do not submit a bare title.

- Use markdown headings (\`##\`) to break into sections. Headings
  that match file paths cause diffs to render inline after that
  section. Other headings become the table of contents.
- Describe WHY each file changed and what to focus on.
- Prose must be >= 10% of diff lines (capped at 200 lines).
- No section longer than 200 lines between headings.
- At least 1 heading per ~100 lines of description.
- Headings ending with \`(collapsed)\` render collapsed by default,
  useful for generated files or changes not worth detailed review.

The server enforces these heuristics and rejects bare submissions.

To skip length validation (with a reason):

\`\`\`bash
curl -s -X POST https://askhuman.app/diff \\
  -F description=@description.md \\
  -F diff=@current.diff \\
  -F skip_length_check="reason here"
\`\`\`

---

## File Review

Submit named files for review with a file selector UI.

### Submit

\`\`\`bash
curl -s -X POST https://askhuman.app/files \\
  -F "src/main.ts=<src/main.ts" \\
  -F "src/utils.ts=<src/utils.ts"
\`\`\`

Each field name is the file path, value is the content (use \`<\`
to read from a local file).

### Poll

\`\`\`bash
curl -s https://askhuman.app/files/<sessionId>/poll
\`\`\`

### Re-upload after code changes

\`\`\`bash
curl -s -X POST https://askhuman.app/files \\
  -F sessionId=<sessionId> \\
  -F "src/main.ts=<src/main.ts"
\`\`\`

Files not included are removed from the review. Comments on
removed files are marked outdated.

### Notes

- The reviewer sees a three-panel UI: file selector, syntax-
  highlighted content, and comments panel.
- Markdown files render with formatted headings, bold, lists.
- Comments include \`file_path\` and \`line\` number.

---

## Playground

Submit a self-contained HTML page as an interactive UI. The user
interacts with it and the agent gets back structured results.

### Submit

\`\`\`bash
curl -s -X POST https://askhuman.app/playground \\
  -F "html=<playground.html"
\`\`\`

### Poll

\`\`\`bash
curl -s https://askhuman.app/playground/<sessionId>/poll
\`\`\`

The response includes \`result\` (from postMessage) and \`threads\`
(comments).

### Update

\`\`\`bash
curl -s -X POST https://askhuman.app/playground \\
  -F sessionId=<sessionId> \\
  -F "html=<playground.html"
\`\`\`

### Building the HTML

- **Single file.** Inline all CSS and JS. No CDN dependencies.
- **Live preview.** Updates instantly on every control change.
- **Dark theme.** Use \`#0a0a0a\` background, light text.
- **Sensible defaults.** Looks good on first load.
- **Presets.** Include 3-5 named presets if the space is large.

### Result API

Send structured data back via postMessage. Call on every state
change so the latest value is always available when Done is clicked:

\`\`\`javascript
const state = { /* all configurable values */ };

function update() {
  renderPreview();
  window.parent.postMessage({
    type: 'askhuman:result',
    data: JSON.stringify(state)
  }, '*');
}
\`\`\`

### Layout

The HTML renders in a sandboxed iframe (\`allow-scripts allow-forms\`)
with the full viewport. Design for ~800x600. Controls and preview
should both be visible without scrolling.

### Common mistakes

- No result sent via postMessage -- agent gets nothing back
- External dependencies -- CDN down means playground is dead
- Preview doesn't update live -- feels broken
- No defaults -- starts empty on first load
`;

writeFileSync(resolve(ROOT, "skills/askhuman/SKILL.md"), skillMd);
console.log("wrote skills/askhuman/SKILL.md");

console.log("done");
