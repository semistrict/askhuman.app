import "@/lib/tools";
import { performToolPoll } from "@/lib/tools/core";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  return performToolPoll("playground", id, request);
}
