/**
 * Generate public docs and skill files from the YAML message sources.
 *
 * Run: npx tsx scripts/generate-docs.ts
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

function m(msgs: Record<string, string>, key: string): string {
  const val = msgs[key];
  if (!val) throw new Error(`Missing message key: ${key}`);
  return val.trimEnd();
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
// skills/diff-review/SKILL.md
// ---------------------------------------------------------------------------

const diffSkill = `---
name: diff-review
description: Submit a diff with a description for human review. The reviewer sees the full diff, leaves numbered comments, and clicks Done. Resubmit after code changes to keep the review current.
---

# Diff Review

Use the askhuman curl API to get human feedback on code changes.

## Rules

- Do **not** use browser automation tools to act as the human reviewer.
- Open the review URL in the real user's browser.
- Use \`curl\` on the agent side.

## Workflow

1. **Submit the diff:**

   \`\`\`bash
   curl -s -X POST https://askhuman.app/diff \\
     -F description=@description.md \\
     -F diff=@current.diff
   \`\`\`

2. **Open the URL** for the reviewer.

3. **Poll for comments** (returns when they click Done):

   \`\`\`bash
   curl -s https://askhuman.app/diff/<sessionId>/poll
   \`\`\`

4. **Address each numbered comment.**

5. **Resubmit after code changes:**

   \`\`\`bash
   curl -s -X POST https://askhuman.app/diff \\
     -F sessionId=<sessionId> \\
     -F description=@description.md \\
     -F diff=@current.diff
   \`\`\`

   Comments on changed hunks are automatically marked outdated.

6. **Loop** steps 3-5 until the review is complete.

## Description Requirements

The description MUST NARRATE the change. Do not submit a diff with a bare title.

- **Use markdown headings** (\`##\`) to break the description into sections -- one per file or logical group. These headings become a table of contents in the review UI.
- **Describe each file**: explain WHY it changed and what the reviewer should focus on.
- **Prose must be >= 15%** of the diff line count. A 200-line diff needs at least 30 lines of description.
- **No section longer than 200 lines** between headings.
- **At least 1 heading per ~100 lines** of description.

The server enforces these heuristics and rejects submissions that fail.

## Poll Status

- \`"done"\` -- comments ready, address them
- \`"timeout"\` -- no activity, poll again
- \`"error"\` -- reviewer not connected, open the URL
`;

writeFileSync(
  resolve(ROOT, "skills/diff-review/SKILL.md"),
  diffSkill
);
console.log("wrote skills/diff-review/SKILL.md");

// ---------------------------------------------------------------------------
// skills/file-review/SKILL.md
// ---------------------------------------------------------------------------

const fileSkill = `---
name: file-review
description: Submit files for human review with a file selector UI. The reviewer navigates files, leaves numbered comments, and clicks Done. Re-upload after code changes -- files not included are removed and their comments marked outdated.
---

# File Review

Use the askhuman curl API to get human feedback on files.

## Rules

- Do **not** use browser automation tools to act as the human reviewer.
- Open the review URL in the real user's browser.
- Use \`curl\` on the agent side.

## Workflow

1. **Submit files:**

   \`\`\`bash
   curl -s -X POST https://askhuman.app/files \\
     -F "src/main.ts=<src/main.ts" \\
     -F "src/utils.ts=<src/utils.ts"
   \`\`\`

   Each field name is the file path, value is the content (use \`<\` to read from file).

2. **Open the URL** for the reviewer.

3. **Poll for comments** (returns when they click Done):

   \`\`\`bash
   curl -s https://askhuman.app/files/<sessionId>/poll
   \`\`\`

4. **Address each numbered comment.**

5. **Re-upload after code changes:**

   \`\`\`bash
   curl -s -X POST https://askhuman.app/files \\
     -F sessionId=<sessionId> \\
     -F "src/main.ts=<src/main.ts"
   \`\`\`

   Files not included are removed. Comments on removed files are marked outdated.

6. **Loop** steps 3-5 until the review is complete.

## Poll Status

- \`"done"\` -- comments ready, address them
- \`"timeout"\` -- no activity, poll again
- \`"error"\` -- reviewer not connected, open the URL
`;

writeFileSync(
  resolve(ROOT, "skills/file-review/SKILL.md"),
  fileSkill
);
console.log("wrote skills/file-review/SKILL.md");

// ---------------------------------------------------------------------------
// skills/playground/SKILL.md
// ---------------------------------------------------------------------------

const playgroundDir = resolve(ROOT, "skills/playground");
import { mkdirSync } from "node:fs";
try { mkdirSync(playgroundDir, { recursive: true }); } catch {}

const playgroundSkill = `---
name: playground
description: Submit a self-contained HTML page as an interactive playground. The human interacts with it, the HTML sends results back via postMessage, and the agent polls for the result when the human clicks Done.
---

# Playground

Use the askhuman curl API to present interactive HTML to the user.

## Rules

- Do **not** use browser automation tools to act as the human.
- Open the playground URL in the real user's browser.
- Use \`curl\` on the agent side.

## Workflow

1. **Submit HTML:**

   \`\`\`bash
   curl -s -X POST https://askhuman.app/playground \\
     -F "html=<playground.html"
   \`\`\`

2. **Open the URL** for the user.

3. **Poll for the result** (returns when they click Done):

   \`\`\`bash
   curl -s https://askhuman.app/playground/<sessionId>/poll
   \`\`\`

4. The response includes \`result\` (from postMessage) and any \`threads\` (comments).

5. **Update HTML if needed:**

   \`\`\`bash
   curl -s -X POST https://askhuman.app/playground \\
     -F sessionId=<sessionId> \\
     -F "html=<playground.html"
   \`\`\`

## HTML Result API

The HTML sends structured data back via:

\`\`\`javascript
window.parent.postMessage({
  type: 'askhuman:result',
  data: JSON.stringify({ key: 'value' })
}, '*');
\`\`\`

The last value sent before Done is returned in the poll response.

## Poll Status

- \`"done"\` -- result and comments ready
- \`"timeout"\` -- no activity, poll again
- \`"error"\` -- user not connected, open the URL
`;

writeFileSync(
  resolve(playgroundDir, "SKILL.md"),
  playgroundSkill
);
console.log("wrote skills/playground/SKILL.md");

// ---------------------------------------------------------------------------
// skills/plan-review/SKILL.md
// ---------------------------------------------------------------------------

const planSkill = `---
name: plan-review
description: Submit a markdown plan for human review. The reviewer sees the plan with line numbers, leaves numbered comments, and clicks Done. Use this when you want a human to review a plan before implementing it.
---

# Plan Review

Use the askhuman curl API to get human feedback on a plan.

## Rules

- Do **not** use browser automation tools to act as the human reviewer.
- Open the review URL in the real user's browser.
- Use \`curl\` on the agent side.

## Workflow

1. **Submit the plan:**

   \`\`\`bash
   curl -s --data-binary @plan.md https://askhuman.app/plan
   \`\`\`

2. **Open the URL** for the reviewer.

3. **Poll for comments** (returns when they click Done):

   \`\`\`bash
   curl -s https://askhuman.app/plan/<sessionId>/poll
   \`\`\`

4. **Address each numbered comment.**

5. **Loop** step 3-4 if the reviewer has more feedback after you make changes.

## Poll Status

- \`"done"\` -- comments ready, address them
- \`"timeout"\` -- no activity, poll again
- \`"error"\` -- reviewer not connected, open the URL
`;

writeFileSync(
  resolve(ROOT, "skills/plan-review/SKILL.md"),
  planSkill
);
console.log("wrote skills/plan-review/SKILL.md");

console.log("done");
