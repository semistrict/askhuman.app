---
name: diff-review
description: Submit a git diff for human review. The diff is parsed into hunks -- you choose which hunks to show and provide a description to narrate the review. The reviewer sees a colored diff with line-specific comments. Use this for focused, agent-guided code review.
---

# Diff Review

Use the askhuman curl API to get human feedback on code changes.

## Rules

- Do **not** use `agent-browser`, Playwright, or similar browser automation tools to act as the human reviewer.
- When human interaction is required, open the review URL in the real user's browser with `open "<url>"`.
- On the agent side, use `curl` to submit, poll, reply, and update the shown hunks.

## Workflow

1. **Submit the diff**: Run:

   ```bash
   git diff | curl --data-binary @- https://askhuman.app/diff
   ```

   You get back a `sessionId`, a list of `hunks` with metadata, and the next curl command to create a review view.

2. **Select hunks to show**: Run:

   ```bash
   curl -X POST https://askhuman.app/diff/<sessionId>/view \
     -H 'Content-Type: application/json' \
     -H 'Accept: application/json' \
     --data-binary '{"hunkIds":[1,2],"description":"Explain these changes."}'
   ```

   You get back a browser `url`.

3. **Open the URL for the reviewer**: Run `open "<url>"` so the reviewer can see the selected hunks in their browser with your description. Do not open it inside an automated browser session.

4. **Poll for comments**: Run:

   ```bash
   curl -H 'Accept: application/json' https://askhuman.app/diff/<sessionId>/poll
   ```

   This long-polls up to 10 minutes and returns one of three statuses:
   - `"comments"` -- new feedback arrived. Make any requested code changes first, then reply in the affected threads. If no code changes are needed, reply immediately.
   - `"timeout"` -- no activity yet. Poll again.
   - `"done"` -- the reviewer clicked Done. The review is finished.

5. **Reply to comments**: After making any requested code changes, run:

   ```bash
   curl -X POST https://askhuman.app/diff/<sessionId>/reply \
     -H 'Content-Type: application/json' \
     -H 'Accept: application/json' \
     --data-binary '{"replies":[{"threadId":1,"text":"your reply"}]}'
   ```

   If a comment does not require code changes, reply immediately.

6. **Show more hunks**: Call the `/diff/<sessionId>/view` curl again with different hunk IDs and a new description to continue narrating the diff. The browser updates in real-time.

7. **Loop**: Keep showing hunks, replying, and polling until the status is `"done"`.

## Tips

- The `hunks` array from `/diff` contains metadata -- use it to decide which hunks to show together and what description to write.
- Group related hunks and provide a clear description of what they do. This helps the reviewer focus.
- You can call `/diff/<sessionId>/view` multiple times to walk through a large diff section by section.
- Comments have a `hunk_id` and `line` (offset within the hunk). Use the `threadId` when replying.
- The reviewer sees your replies in real-time via WebSocket.
- Use the real user's browser for review interactions and `curl` for the agent side.
