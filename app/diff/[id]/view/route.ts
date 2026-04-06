import { showHunks, ShowHunksValidationError } from "@/lib/diff-review";
import {
  errorMarkdown,
  negotiatedResponse,
  viewUpdateMarkdown,
} from "@/lib/rest-response";
import { z } from "zod";

const showHunksSchema = z.object({
  hunkIds: z.array(z.number().int()).min(1),
  description: z.string(),
});

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const body = showHunksSchema.safeParse(await request.json());
  if (!body.success) {
    const error = {
      error: "Invalid show_hunks payload.",
      issues: body.error.flatten(),
    };
    return negotiatedResponse(
      request,
      error,
      errorMarkdown(error.error, error.issues),
      { status: 400 }
    );
  }
  const baseUrl = new URL("/", request.url).toString().replace(/\/$/, "");
  try {
    const result = await showHunks(
      id,
      body.data.hunkIds,
      body.data.description,
      baseUrl
    );
    return negotiatedResponse(request, result, viewUpdateMarkdown(result));
  } catch (error) {
    if (error instanceof ShowHunksValidationError) {
      const payload = { error: error.message };
      return negotiatedResponse(
        request,
        payload,
        errorMarkdown(payload.error),
        { status: error.status }
      );
    }
    throw error;
  }
}
