import { PlanSession } from "@/worker/plan-session";
import type { Thread } from "@/worker/plan-session";
import { ReviewClient } from "./review-client";

export default async function SessionPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const session = PlanSession.getInstance(id);
  const plan = await session.getPlan();

  if (!plan) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <p className="text-muted-foreground">No plan found for this session.</p>
      </div>
    );
  }

  const threads: Thread[] = await session.getThreads();
  const planLines = plan.markdown.split("\n");

  return (
    <ReviewClient
      sessionId={id}
      planLines={planLines}
      initialThreads={threads}
    />
  );
}
