import "@/lib/tools";
import { performToolPoll } from "@/lib/tools/core";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ tool: string; id: string }> }
) {
  const { tool, id } = await params;
  return performToolPoll(tool, id, request);
}
