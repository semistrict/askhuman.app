import { createSession, initSession } from "@/lib/plan-review";

export async function POST() {
  const id = createSession();
  await initSession(id);
  return Response.json({ id });
}
