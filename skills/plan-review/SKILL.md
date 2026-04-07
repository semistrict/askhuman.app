---
name: plan-review
description: Submit a markdown plan for human review. The reviewer sees the plan with line numbers, leaves numbered comments, and clicks Done. Use this when you want a human to review a plan before implementing it.
---

# Plan Review

Use the askhuman curl API to get human feedback on a plan.

## Rules

- Do **not** use browser automation tools to act as the human reviewer.
- Open the review URL in the real user's browser.
- Use `curl` on the agent side.

## Workflow

1. **Submit the plan:**

   ```bash
   curl -s --data-binary @plan.md https://askhuman.app/plan
   ```

2. **Open the URL** for the reviewer.

3. **Poll for comments** (returns when they click Done):

   ```bash
   curl -s https://askhuman.app/plan/<sessionId>/poll
   ```

4. **Address each numbered comment.**

5. **Loop** step 3-4 if the reviewer has more feedback after you make changes.

## Poll Status

- `"done"` -- comments ready, address them
- `"timeout"` -- no activity, poll again
- `"error"` -- reviewer not connected, open the URL
