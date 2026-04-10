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
const share = loadYaml("share.yaml");

// ---------------------------------------------------------------------------
// public/llms.txt
// ---------------------------------------------------------------------------

const llmsTxt = `# askhuman.app

Human-in-the-loop review tools for AI agents.
Start a tool session, open the URL for the user, then submit the tool payload.

## Review

Start a review session:

  curl -s -X POST https://askhuman.app/review

## Diff review

  curl -s -X POST https://askhuman.app/diff

## Present

  curl -s -X POST https://askhuman.app/present

## Playground

  curl -s -X POST https://askhuman.app/playground

## Encrypted share

  curl -s -X POST https://askhuman.app/share

Each start call returns a sessionId, a review URL, and the exact next call.
Open the URL for the same user you are already interacting with.
Review, diff, present, and playground sessions can optionally switch to
end-to-end encryption if the user enables it in the browser before submission.
Encrypted share sessions always use end-to-end encryption.
For large inputs, write them to a temporary file first and submit with
\`-F "name=<path"\` or \`@path\` instead of inlining huge strings.
For a cleaner reviewer window, prefer Chrome app mode:
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" --app="URL" &
The tool submit call waits for the human and then polls automatically.
Standalone poll is still available with GET .../{id}/poll.
`;

writeFileSync(resolve(ROOT, "public/llms.txt"), llmsTxt);
console.log("wrote public/llms.txt");

// ---------------------------------------------------------------------------
// skills/askhuman/SKILL.md
// ---------------------------------------------------------------------------

const skillMd = `---
name: askhuman
description: >-
  Human-in-the-loop review tools. Submit plans, diffs, files,
  interactive HTML playgrounds, or encrypted document shares for the
  same user the agent is already interacting with. The user reviews in
  the browser, leaves numbered comments when applicable, clicks Done,
  and the agent polls for feedback.
---

# askhuman.app

Human-in-the-loop review tools for AI agents. Submit content via
curl, open the returned URL for the user, poll for their feedback.

Review, diff, present, and playground sessions can optionally switch to
browser-managed end-to-end encryption before the agent submits content.
Encrypted share sessions always require end-to-end encryption.

## Rules

- Do **not** use browser automation tools to act as the human.
- Open the review URL in the real user's browser.
- Use \`curl\` on the agent side for all API calls.

## Common Pattern

All five tools follow the same flow:

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

---

## Encrypted Share

Submit an encrypted markdown document. The server stores only the ciphertext
envelope; the browser keeps a private key in localStorage and shares only a
short-lived public-key reference with the agent.

### Bootstrap

\`\`\`bash
curl -s -X POST https://askhuman.app/share
\`\`\`

### Reviewer setup

Open the session page in the browser. If that browser has not enabled
end-to-end encryption yet, it will prompt the user to:

- allow localStorage-backed key storage
- generate a local private key
- upload a 24-hour public-key reference
- copy public-key instructions back to the agent

### Submit

\`\`\`bash
curl -s -X POST https://askhuman.app/share/<sessionId> \\
  -H 'Content-Type: application/json' \\
  --data-binary @encrypted-share.json
\`\`\`

### Notes

- The JSON body must contain \`version\`, \`alg\`, \`recipientKeyId\`, \`encryptedKey\`, \`iv\`, \`ciphertext\`, and \`mac\`.
- The built-in envelope uses RSA-OAEP-SHA256 to wrap a fresh \`aesKey || hmacKey\` blob for AES-256-CBC + HMAC-SHA256.
- The copied agent instructions include a short-lived key URL that returns \`recipientKeyId\` and \`publicKeySpki\`.
- The reviewer private key stays in that browser's localStorage and is never sent to the server.
`;

writeFileSync(resolve(ROOT, "skills/askhuman/SKILL.md"), skillMd);
console.log("wrote skills/askhuman/SKILL.md");

console.log("done");
