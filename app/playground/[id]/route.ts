import "@/lib/tools";
import { performToolAction } from "@/lib/tools/core";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  return performToolAction("playground", id, request);
}
