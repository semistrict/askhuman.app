---
name: plan-review
description: Submit a markdown plan for human review in the browser. The reviewer posts threaded comments (general or on specific lines), you reply, and loop until they're done. Use this when you want a human to review a plan before you implement it.
---

# Plan Review

Use the plan-review MCP tools to get human feedback on a plan before implementing it.

## Workflow

1. **Submit the plan**: Call `submit_plan` with your markdown plan. You get back a `sessionId` and a browser `url`.

2. **Open the URL for the reviewer**: Run `open "<url>"` so the reviewer can see the plan in their browser.

3. **Poll for comments**: Call `get_comments` with the `sessionId`. This long-polls (blocks up to 30s by default). It returns one of three statuses:
   - `"comments"` — new feedback arrived. Read the threads and reply.
   - `"timeout"` — no activity yet. Call `get_comments` again.
   - `"done"` — the reviewer clicked Done. The review is finished.

4. **Reply to comments**: Call `reply_to_comments` with the `sessionId` and an array of `{ threadId, text }` replies. This posts your replies (visible in the reviewer's browser via WebSocket) and automatically polls for the next round of comments.

5. **Loop**: Keep calling `reply_to_comments` (which auto-polls) or `get_comments` until the status is `"done"`.

## Tools

### submit_plan
- **Input**: `{ markdown: string }`
- **Output**: `{ sessionId, url, message }`

### get_comments
- **Input**: `{ sessionId: string, timeoutSeconds?: number }`
- **Output**: `{ sessionId, status, threads, message? }`

### reply_to_comments
- **Input**: `{ sessionId: string, replies: [{ threadId: number, text: string }], timeoutSeconds?: number }`
- **Output**: `{ sessionId, sent, status, threads }`

## Tips

- The `sessionId` is a UUID that identifies the review session. Include it in every tool call after `submit_plan`.
- Comments have a `line` field (number or null). Null means a general comment; a number means the reviewer commented on that specific line of the plan.
- Each thread has an `id` — use it as the `threadId` when replying.
- The reviewer sees your replies in real-time via WebSocket. No need to tell them to refresh.
- You can also interact with the same session via the REST API (curl) if needed. The session ID works across both interfaces.
