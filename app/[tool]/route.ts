import "@/lib/tools";
import { bootstrapToolSession } from "@/lib/tools/core";
import { errorMarkdown, negotiatedResponse } from "@/lib/rest-response";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ tool: string }> }
) {
  const { tool } = await params;
  return bootstrapToolSession(tool, request);
}

export async function GET(request: Request) {
  const error = { error: "Use POST to create a tool-specific session." };
  return negotiatedResponse(request, error, errorMarkdown(error.error), { status: 405 });
}
