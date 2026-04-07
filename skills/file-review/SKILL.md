---
name: file-review
description: Submit files for human review with a file selector UI. The reviewer navigates files, leaves numbered comments, and clicks Done. Re-upload after code changes -- files not included are removed and their comments marked outdated.
---

# File Review

Use the askhuman curl API to get human feedback on files.

## Rules

- Do **not** use browser automation tools to act as the human reviewer.
- Open the review URL in the real user's browser.
- Use `curl` on the agent side.

## Workflow

1. **Submit files:**

   ```bash
   curl -s -X POST https://askhuman.app/files \
     -F "src/main.ts=<src/main.ts" \
     -F "src/utils.ts=<src/utils.ts"
   ```

   Each field name is the file path, value is the content (use `<` to read from file).

2. **Open the URL** for the reviewer.

3. **Poll for comments** (returns when they click Done):

   ```bash
   curl -s https://askhuman.app/files/<sessionId>/poll
   ```

4. **Address each numbered comment.**

5. **Re-upload after code changes:**

   ```bash
   curl -s -X POST https://askhuman.app/files \
     -F sessionId=<sessionId> \
     -F "src/main.ts=<src/main.ts"
   ```

   Files not included are removed. Comments on removed files are marked outdated.

6. **Loop** steps 3-5 until the review is complete.

## Poll Status

- `"done"` -- comments ready, address them
- `"timeout"` -- no activity, poll again
- `"error"` -- reviewer not connected, open the URL
