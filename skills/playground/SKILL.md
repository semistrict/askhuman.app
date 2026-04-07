---
name: playground
description: Submit a self-contained HTML page as an interactive playground. The human interacts with it, the HTML sends results back via postMessage, and the agent polls for the result when the human clicks Done. Use when the input space is visual, structural, or hard to express as plain text.
---

# Playground

Build a self-contained HTML file with interactive controls and a
live preview, then submit it via curl. The user interacts with it
in the browser and clicks Done. The agent polls and gets back the
structured result.

## When to use

When the user needs to configure, explore, or choose something
that is visual, spatial, or has too many dimensions for a text
conversation -- design tokens, color schemes, layout options,
data queries, flow diagrams, or any interactive decision.

## Workflow

1. **Build the HTML** as a single self-contained file. Inline all
   CSS and JS. No external dependencies.

2. **Submit:**

   ```bash
   curl -s -X POST https://askhuman.app/playground \
     -F "html=<playground.html"
   ```

3. **Open the URL** for the user.

4. **Poll** (returns when they click Done):

   ```bash
   curl -s https://askhuman.app/playground/<sessionId>/poll
   ```

5. The response includes `result` (from postMessage) and any
   `threads` (comments).

6. **Update** if needed:

   ```bash
   curl -s -X POST https://askhuman.app/playground \
     -F sessionId=<sessionId> \
     -F "html=<playground.html"
   ```

## Building the HTML

### Core requirements

- **Single HTML file.** Inline all CSS and JS. No CDN dependencies.
- **Live preview.** Updates instantly on every control change.
- **Sensible defaults + presets.** Looks good on first load.
  Include 3-5 named presets if the space is large.
- **Dark theme.** Use `#0a0a0a` background, light text.
  System font for UI, monospace for code/values.

### Result API

The HTML sends structured data back to the agent via postMessage.
Call this on every state change so the latest value is always
available when the user clicks Done:

```javascript
const state = { /* all configurable values */ };

function update() {
  renderPreview();
  // Send result to agent
  window.parent.postMessage({
    type: 'askhuman:result',
    data: JSON.stringify(state)
  }, '*');
}
```

The last value sent before Done is returned in the poll response.

### State management

Keep a single state object. Every control writes to it, every
render reads from it. Call `update()` on every change.

### Layout

The HTML renders inside a sandboxed iframe with the full viewport.
Design for a roughly 800x600 area. Controls and preview should
both be visible without scrolling. Common layouts:

- Controls on the left/top, preview on the right/bottom
- Controls as an overlay bar, preview fills the frame
- Tabbed sections for complex configuration spaces

### Common mistakes

- No result sent via postMessage -- the agent gets nothing
- External dependencies -- if CDN is down, playground is dead
- Preview doesn't update live -- feels broken
- No defaults -- starts empty or broken on first load
- Too many controls at once -- group by concern, use collapsibles

## Poll Status

- `"done"` -- result and comments ready
- `"timeout"` -- no activity, poll again
- `"error"` -- user not connected, open the URL
