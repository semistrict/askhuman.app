import "@/lib/tools";
import { bootstrapToolSession } from "@/lib/tools/core";

export async function POST(request: Request) {
  return bootstrapToolSession("diff", request);
}
