---
name: file-review
description: Submit files for human review in the browser. The reviewer can navigate between files, leave line-specific or general comments, and the agent polls for feedback. Re-upload files after code changes to keep the review current -- files not re-uploaded are removed and their comments marked outdated.
---

# File Review

Use the askhuman curl API to get human feedback on files.

## Rules

- Do **not** use `agent-browser`, Playwright, or similar browser automation tools to act as the human reviewer.
- When human interaction is required, open the review URL in the real user's browser with `open "<url>"`.
- On the agent side, use `curl` to create the session, poll, reply, and re-upload.

## Workflow

1. **Submit files for review**: Run:

   ```bash
   curl -s -X POST https://askhuman.app/files \
     -F "src/main.ts=<src/main.ts" \
     -F "src/utils.ts=<src/utils.ts" \
     -F "README.md=<README.md"
   ```

   Each form field name is the file path, and the value is the file content. Use `<` to read from a local file.

   You get back a `sessionId`, the reviewer URL, and instructions for polling and replying.

2. **Open the URL for the reviewer**: Run `open "<url>"` so the reviewer can see the files in their browser. Do not open it inside an automated browser session.

3. **Poll for comments**: Run:

   ```bash
   curl -s https://askhuman.app/files/<sessionId>/poll
   ```

   This long-polls up to 10 minutes and returns immediately when comments arrive.

4. **Reply to comments**: After making any requested code changes, run:

   ```bash
   curl -s -X POST https://askhuman.app/files/<sessionId>/reply \
     -F threadId=1 \
     -F text='your reply'
   ```

   If a comment does not require code changes, reply immediately.

5. **Re-upload after code changes**: After making code changes, re-upload all files:

   ```bash
   curl -s -X POST https://askhuman.app/files \
     -F sessionId=<sessionId> \
     -F "src/main.ts=<src/main.ts" \
     -F "src/utils.ts=<src/utils.ts"
   ```

   Files not included in the re-upload are removed from the review. Comments on removed files are automatically marked outdated.

6. **Loop**: Continue polling, replying, and re-uploading until the reviewer clicks Done (status becomes "done").

## Poll Status

`GET /files/<sessionId>/poll` returns one of these statuses:

- `"comments"` -- new feedback arrived. Immediately begin addressing it and do not wait for confirmation.
- `"timeout"` -- no activity yet. Poll again.
- `"error"` -- the reviewer has not connected yet. Ask the same user to open the review URL.
- `"done"` -- the session is complete.

## Tips

- Always re-upload ALL files you want to keep in the review. Files not included are treated as removed.
- Comments have a `file_path` and `line` number. Use the `threadId` when replying.
- The reviewer sees your replies in real-time via WebSocket.
- Use the real user's browser for review interactions and `curl` for the agent side.
