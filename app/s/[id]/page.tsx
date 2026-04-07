import { SessionDO } from "@/worker/session";
import type { Thread, ViewSection } from "@/worker/session";
import { ReviewClient } from "./review-client";
import { DiffReviewClient } from "./diff-review-client";

export default async function SessionPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const session = SessionDO.getInstance(id);
  const contentType = await session.getContentType();

  if (contentType === "diff") {
    const threads: Thread[] = await session.getThreads();
    const hasActiveRequest = await session.hasActiveReviewRequest();
    const view = hasActiveRequest ? await session.getView() : null;
    const hunks = view ? await session.getHunksByIds(view.hunkIds) : [];
    const doneLabel = (await session.hasMoreUnreviewedHunksAfterCurrentView())
      ? "Next"
      : "Done";
    return (
      <DiffReviewClient
        sessionId={id}
        hunks={hunks}
        sections={(view?.sections ?? []) as ViewSection[]}
        initialThreads={threads}
        doneLabel={doneLabel}
      />
    );
  }

  const data = await session.getContent();
  if (!data) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <p className="text-muted-foreground">No content found for this session.</p>
      </div>
    );
  }

  const threads: Thread[] = await session.getThreads();
  const lines = data.content.split("\n");

  return (
    <ReviewClient
      sessionId={id}
      planLines={lines}
      initialThreads={threads}
    />
  );
}
