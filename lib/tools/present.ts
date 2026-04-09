import { parsePresentationRequest, createPresentationSession, updatePresentationSession } from "@/lib/present";
import { SessionDO } from "@/worker/session";
import type { Tool } from "@/lib/tools/types";

type PresentActionInput = Awaited<ReturnType<typeof parsePresentationRequest>>;

export const presentTool: Tool<PresentActionInput> = {
  id: "present",
  aliases: ["remark"],

  async bootstrap({ sessionId, baseUrl }) {
    const url = `${baseUrl}/s/${sessionId}`;
    const chromeApp = `"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" --app="${url}" &`;
    const fallback = `open "${url}"`;
    return {
      sessionId,
      url,
      tool: "present",
      openCommands: { chromeApp, fallback },
      message: [
        "Ask the user to open this presentation review page.",
        "Do not wait for confirmation after launching it.",
        "Immediately submit the presentation payload in the next request.",
        "Prefer Chrome app mode for a clean dedicated window:",
        `  ${chromeApp}`,
        "Fallback:",
        `  ${fallback}`,
      ].join("\n"),
      next: [
        "Immediately after opening the page, submit the presentation payload:",
        "",
        `curl -s -X POST ${baseUrl}/present/${sessionId} \\`,
        `  -F "markdown=<slides.md"`,
      ].join("\n"),
    };
  },

  async parseActionRequest(request) {
    const parsed = await parsePresentationRequest(request);
    return { ...parsed, sessionId: null };
  },

  async applyAction({ sessionId, baseUrl, input }) {
    const session = SessionDO.getInstance(sessionId);
    const phase = await session.getSessionPhase();
    if (phase === "awaiting_init") {
      await createPresentationSession(sessionId, input.markdown, baseUrl);
    } else {
      await updatePresentationSession(sessionId, input.markdown, baseUrl);
    }
    return { sessionId, pollPrefix: "present" };
  },

  async poll({ sessionId, baseUrl }) {
    const { pollPresentation } = await import("@/lib/present");
    return pollPresentation(sessionId, baseUrl);
  },
};
