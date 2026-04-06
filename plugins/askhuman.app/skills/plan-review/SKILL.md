---
name: plan-review
description: Submit a markdown plan for human review in the browser. The reviewer posts threaded comments (general or on specific lines), you reply, and loop until they're done. Use this when you want a human to review a plan before you implement it.
---

# Plan Review

Use the askhuman curl API to get human feedback on a plan before implementing it.

## Rules

- Do **not** use `agent-browser`, Playwright, or similar browser automation tools to act as the human reviewer.
- When human interaction is required, open the review URL in the real user's browser with `open "<url>"`.
- On the agent side, use `curl` to submit, poll, and reply.

## Workflow

1. **Submit the plan**: Run:

   ```bash
   curl --data-binary @plan.md https://askhuman.app/plan
   ```

   You get back a `sessionId`, a browser `url`, and ready-to-run curl commands for polling and replying.

2. **Open the URL for the reviewer**: Run `open "<url>"` so the reviewer can see the plan in their browser. Do not open it inside an automated browser session.

3. **Poll for comments**: Run the poll curl command returned by submit, or:

   ```bash
   curl -H 'Accept: application/json' https://askhuman.app/plan/<sessionId>/poll
   ```

   This long-polls up to 10 minutes and returns one of three statuses:
   - `"comments"` — new feedback arrived. Make any requested code changes first, then reply in the affected threads. If no code changes are needed, reply immediately.
   - `"timeout"` — no activity yet. Poll again.
   - `"done"` — the reviewer clicked Done. The review is finished.

4. **Reply to comments**: After making any requested code changes, run the reply curl command returned by poll, or:

   ```bash
   curl -X POST https://askhuman.app/plan/<sessionId>/reply \
     -H 'Content-Type: application/json' \
     -H 'Accept: application/json' \
     --data-binary '{"replies":[{"threadId":1,"text":"your reply"}]}'
   ```

   If a comment does not require code changes, reply immediately. This posts your replies (visible in the reviewer's browser via WebSocket) and automatically polls for the next round of comments.

5. **Loop**: Keep polling and replying until the status is `"done"`.

## Tips

- The `sessionId` is a UUID that identifies the review session. Include it in every curl after submit.
- Comments have a `line` field (number or null). Null means a general comment; a number means the reviewer commented on that specific line of the plan.
- Each thread has an `id` — use it as the `threadId` when replying.
- The reviewer sees your replies in real-time via WebSocket. No need to tell them to refresh.
- Use the real user's browser for review interactions and `curl` for the agent side.
