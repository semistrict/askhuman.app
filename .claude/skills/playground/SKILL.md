---
name: playground
description: Submit a self-contained HTML page as an interactive playground. The human interacts with it, the HTML sends results back via postMessage, and the agent polls for the result when the human clicks Done.
---

# Playground

Use the askhuman curl API to present interactive HTML to the user.

## Rules

- Do **not** use browser automation tools to act as the human.
- Open the playground URL in the real user's browser.
- Use `curl` on the agent side.

## Workflow

1. **Submit HTML:**

   ```bash
   curl -s -X POST https://askhuman.app/playground \
     -F "html=<playground.html"
   ```

2. **Open the URL** for the user.

3. **Poll for the result** (returns when they click Done):

   ```bash
   curl -s https://askhuman.app/playground/<sessionId>/poll
   ```

4. The response includes `result` (from postMessage) and any `threads` (comments).

5. **Update HTML if needed:**

   ```bash
   curl -s -X POST https://askhuman.app/playground \
     -F sessionId=<sessionId> \
     -F "html=<playground.html"
   ```

## HTML Result API

The HTML sends structured data back via:

```javascript
window.parent.postMessage({
  type: 'askhuman:result',
  data: JSON.stringify({ key: 'value' })
}, '*');
```

The last value sent before Done is returned in the poll response.

## Poll Status

- `"done"` -- result and comments ready
- `"timeout"` -- no activity, poll again
- `"error"` -- user not connected, open the URL
