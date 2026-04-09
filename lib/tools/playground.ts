import { parsePlaygroundFormData, createPlayground, updatePlayground, pollPlayground } from "@/lib/playground";
import { SessionDO } from "@/worker/session";
import type { Tool } from "@/lib/tools/types";
import { playgroundPollMarkdown } from "@/lib/rest-response";

type PlaygroundActionInput = ReturnType<typeof parsePlaygroundFormData>;

export const playgroundTool: Tool<PlaygroundActionInput> = {
  id: "playground",

  async bootstrap({ sessionId, baseUrl }) {
    const url = `${baseUrl}/s/${sessionId}`;
    const chromeApp = `"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" --app="${url}" &`;
    const fallback = `open "${url}"`;
    return {
      sessionId,
      url,
      tool: "playground",
      openCommands: { chromeApp, fallback },
      message: [
        "Ask the user to open this playground review page.",
        "Do not wait for confirmation after launching it.",
        "Immediately submit the playground payload in the next request.",
        "Prefer Chrome app mode for a clean dedicated window:",
        `  ${chromeApp}`,
        "Fallback:",
        `  ${fallback}`,
      ].join("\n"),
      next: [
        "Immediately after opening the page, submit the playground payload:",
        "",
        `curl -s -X POST ${baseUrl}/playground/${sessionId} \\`,
        `  -F "html=<playground.html"`,
      ].join("\n"),
    };
  },

  async parseActionRequest(request) {
    return parsePlaygroundFormData(await request.formData());
  },

  async applyAction({ sessionId, baseUrl, input }) {
    const session = SessionDO.getInstance(sessionId);
    const phase = await session.getSessionPhase();
    if (phase === "awaiting_init") {
      await createPlayground(sessionId, input.html, baseUrl);
    } else {
      await updatePlayground(sessionId, input.html, baseUrl);
    }
    return { sessionId, pollPrefix: "playground" };
  },

  async poll({ sessionId, baseUrl }) {
    return pollPlayground(sessionId, baseUrl);
  },

  renderPollMarkdown(result) {
    return playgroundPollMarkdown(result as never);
  },
};
