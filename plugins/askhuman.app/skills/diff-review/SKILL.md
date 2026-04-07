---
name: diff-review
description: Review a diff with the same human user the agent is already interacting with. Submit the full diff and a description, then poll for comments. Resubmit after code changes to keep the review current -- comments on changed hunks are automatically marked outdated.
---

# Diff Review

Use the askhuman curl API to get human feedback on code changes.

## Rules

- Do **not** use `agent-browser`, Playwright, or similar browser automation tools to act as the human reviewer.
- When human interaction is required, open the review URL in the real user's browser with `open "<url>"`.
- On the agent side, use `curl` to create the session, poll, reply, and resubmit.

## Workflow

1. **Create the diff session**: Run:

   ```bash
   curl -s -X POST https://askhuman.app/diff \
     -F description=@description.md \
     -F diff=@current.diff
   ```

   You get back a `sessionId`, the reviewer URL, and instructions for polling and replying.

2. **Open the URL for the reviewer**: Run `open "<url>"` so the reviewer can see the full diff in their browser. Do not open it inside an automated browser session.

3. **Poll for comments**: Run:

   ```bash
   curl -s https://askhuman.app/diff/<sessionId>/poll
   ```

   This long-polls up to 10 minutes and returns immediately when comments arrive.

4. **Reply to comments**: After making any requested code changes, run:

   ```bash
   curl -s -X POST https://askhuman.app/diff/<sessionId>/reply \
     -F threadId=1 \
     -F text='your reply'
   ```

   If a comment does not require code changes, reply immediately.

5. **Resubmit after code changes**: After making code changes, regenerate `current.diff` and resubmit:

   ```bash
   curl -s -X POST https://askhuman.app/diff \
     -F sessionId=<sessionId> \
     -F description=@description.md \
     -F diff=@current.diff
   ```

   Comments on hunks that changed are automatically marked outdated. Comments on unchanged hunks survive.

6. **Loop**: Continue polling, replying, and resubmitting until the reviewer clicks Done (status becomes "done").

## Poll Status

`GET /diff/<sessionId>/poll` returns one of these statuses:

- `"comments"` -- new feedback arrived. Immediately begin addressing it and do not wait for confirmation. Make any requested code changes first, then reply in the affected threads. If no code changes are needed, reply immediately.
- `"timeout"` -- no activity yet. Poll again.
- `"error"` -- the reviewer has not connected yet. Ask the same user to open the review URL and then poll again.
- `"done"` -- the session is complete.

## Tips

- Always send the latest full diff when resubmitting. The server tracks which hunks changed and marks outdated comments automatically.
- Write a clear `description.md` that explains what changed and why.
- Comments have a `hunk_id`, `line` (offset within the hunk), and `file_path`. Use the `threadId` when replying.
- The reviewer sees your replies in real-time via WebSocket.
- Use the real user's browser for review interactions and `curl` for the agent side.
