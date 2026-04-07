import { getImmediateDiffAgentResponse } from "@/lib/diff-review";
import { requestMarkdown } from "@/lib/rest-response";
import { SessionDO } from "@/worker/session";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const session = SessionDO.getInstance(id);
  if ((await session.getContentType()) === "diff") {
    const result = await session.completeCurrentReviewRequest();
    if (!result.done && !(await session.hasConnectedAgents())) {
      const baseUrl = new URL("/", request.url).toString().replace(/\/$/, "");
      const agentResponse = await getImmediateDiffAgentResponse(id, baseUrl);
      return Response.json({
        ok: true,
        ...result,
        agentMessage: requestMarkdown(agentResponse),
      });
    }
    return Response.json({ ok: true, ...result });
  }

  await session.markDone();
  return Response.json({ ok: true, done: true });
}
