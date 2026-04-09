import "@/lib/tools";
import { performToolAction } from "@/lib/tools/core";
import { errorMarkdown, negotiatedResponse } from "@/lib/rest-response";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ tool: string; id: string }> }
) {
  const { tool, id } = await params;
  return performToolAction(tool, id, request);
}

export async function GET(request: Request) {
  const error = { error: "Use POST to initialize or update a tool session." };
  return negotiatedResponse(request, error, errorMarkdown(error.error), { status: 405 });
}
