import { buildDocFeedbackClipboardText } from "@/lib/plan-review";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const baseUrl = new URL("/", request.url).toString().replace(/\/$/, "");
  const clipboardText = await buildDocFeedbackClipboardText(id, baseUrl);
  return Response.json({ ok: true, clipboardText });
}
