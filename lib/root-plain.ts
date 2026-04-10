export function buildRootPlainText(baseUrl: string): string {
  return `# askhuman.app

Human-in-the-loop review tools for AI agents.
Start a tool session, open the URL for the user, then submit the tool payload.

## Review

Start a review session:

  curl -s -X POST ${baseUrl}/review

## Diff review

  curl -s -X POST ${baseUrl}/diff

## Present

  curl -s -X POST ${baseUrl}/present

## Playground

  curl -s -X POST ${baseUrl}/playground

## Encrypted share

  curl -s -X POST ${baseUrl}/share

Each start call returns a sessionId, a review URL, and the exact next call.
Open the URL for the same user you are already interacting with.
Review, diff, present, and playground sessions can optionally switch to
end-to-end encryption if the user enables it in the browser before submission.
Encrypted share sessions always use end-to-end encryption.
For large inputs, write them to a temporary file first and submit with
\`-F "name=<path"\` or \`@path\` instead of inlining huge strings.
For a cleaner reviewer window, prefer Chrome app mode:
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" --app="URL" &
The tool submit call waits for the human and then polls automatically.
Standalone poll is still available with GET .../{id}/poll.
`;
}
