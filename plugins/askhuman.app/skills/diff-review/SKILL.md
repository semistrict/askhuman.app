---
name: diff-review
description: Review a diff with the same human user the agent is already interacting with. Start an empty diff session, then repeatedly send the latest full diff plus a markdown request document whose patch fences identify the hunks to show. Use this when code may change during review and the agent must keep the visible diff current.
---

# Diff Review

Use the askhuman curl API to get human feedback on code changes.

## Rules

- Do **not** use `agent-browser`, Playwright, or similar browser automation tools to act as the human reviewer.
- When human interaction is required, open the review URL in the real user's browser with `open "<url>"`.
- On the agent side, use `curl` to create the session, send `/request`, reply, dismiss, and complete.

## Workflow

1. **Create the diff session**: Run:

   ```bash
   curl -s -X POST https://askhuman.app/diff
   ```

   You get back a `sessionId`, the reviewer URL, and the next curl command to send `/request`.

2. **Write a request document**: Create `description.md` with normal markdown plus `patch` fences. Each `patch` fence contains literal diff text from one hunk. It can be the whole hunk or just enough of the beginning and end, with `...` between them, to identify the hunk uniquely.

   Example:

   ~~~md
   # Parser change

   This updates the grammar and the generated parser together.

   ```patch
   sql.y
   @@ -120,6 +120,7 @@
   ...
   + VOLATILE
   ```
   ~~~

3. **Send the review request**: Run:

   ```bash
   curl -s -X POST https://askhuman.app/diff/<sessionId>/request \
     -F description=@description.md \
     -F diff=@current.diff
   ```

   This both updates the shown review and waits for reviewer activity. Re-post the exact same request body when you want to keep waiting on that same request.

4. **Open the URL for the reviewer**: Run `open "<url>"` so the reviewer can see the rendered markdown with expanded hunks in their browser. Do not open it inside an automated browser session.

5. **Reply to comments**: After making any requested code changes, run:

   ```bash
   curl -s -X POST https://askhuman.app/diff/<sessionId>/reply \
     -F threadId=1 \
     -F text='your reply'
   ```

   If a comment does not require code changes, reply immediately.

6. **Show the next batch**: After code changes or when moving to the next logical unit, regenerate `current.diff` and send a fresh `/request` with the latest full diff and the next markdown request document.

7. **Dismiss only when necessary**: If you are sure the current request is abandoned and there are no unread human comments, run:

   ```bash
   curl -s -X POST https://askhuman.app/diff/<sessionId>/dismiss
   ```

8. **Complete the review**: When every hunk in the latest diff has been reviewed, run:

   ```bash
   git diff | curl -s -X POST --data-binary @- https://askhuman.app/diff/<sessionId>/complete
   ```

## Request Status

`POST /diff/<sessionId>/request` returns one of these statuses:

- `"comments"` -- new feedback arrived. Immediately begin addressing it and do not wait for confirmation. Make any requested code changes first, then reply in the affected threads. If no code changes are needed, reply immediately.
- `"timeout"` -- no activity yet. Re-post the same `/request` body if you want to keep waiting.
- `"error"` -- the reviewer has not connected yet. Ask the same user to open the review URL and then re-run the same `/request`.
- `"next"` -- the current request is complete. Send the next `/request`, or call `/complete` if every hunk in the latest diff has been reviewed.
- `"done"` -- the session is already complete.

## Tips

- Always send the latest full diff in every `/request`. That is the guardrail that keeps the visible review in sync after code changes.
- Group related hunks and provide clear commentary between `patch` fences. This helps the reviewer focus.
- Keep each `/request` to at most 200 rendered lines total, unless a single hunk is longer than that on its own.
- The session tracks reviewed coverage by file path and hunk content hash. If the hunk changes after edits, it must be reviewed again in a fresh `/request`.
- Comments have a `hunk_id` and `line` (offset within the hunk). Use the `threadId` when replying.
- The reviewer sees your replies in real-time via WebSocket.
- Use the real user's browser for review interactions and `curl` for the agent side.
