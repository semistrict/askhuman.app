---
name: diff-review
description: Submit a diff with a description for human review. The reviewer sees the full diff, leaves numbered comments, and clicks Done. Resubmit after code changes to keep the review current.
---

# Diff Review

Use the askhuman curl API to get human feedback on code changes.

## Rules

- Do **not** use browser automation tools to act as the human reviewer.
- Open the review URL in the real user's browser.
- Use `curl` on the agent side.

## Workflow

1. **Submit the diff:**

   ```bash
   curl -s -X POST https://askhuman.app/diff \
     -F description=@description.md \
     -F diff=@current.diff
   ```

2. **Open the URL** for the reviewer.

3. **Poll for comments** (returns when they click Done):

   ```bash
   curl -s https://askhuman.app/diff/<sessionId>/poll
   ```

4. **Address each numbered comment.**

5. **Resubmit after code changes:**

   ```bash
   curl -s -X POST https://askhuman.app/diff \
     -F sessionId=<sessionId> \
     -F description=@description.md \
     -F diff=@current.diff
   ```

   Comments on changed hunks are automatically marked outdated.

6. **Loop** steps 3-5 until the review is complete.

## Poll Status

- `"done"` -- comments ready, address them
- `"timeout"` -- no activity, poll again
- `"error"` -- reviewer not connected, open the URL
