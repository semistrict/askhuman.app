# Future Ideas

## Browser-side creator

The current product is agent-first: the agent generates a self-contained HTML file,
encrypts it locally, uploads ciphertext, and gives the human a URL with the key in
the fragment.

A future browser-side creator could let a human drag in an HTML file and produce
the same encrypted link locally. That should remain a separate flow so the root
curl instructions stay small and reliable for agents.
