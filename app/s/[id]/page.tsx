import { SessionDO } from "@/worker/session";
import type { Thread } from "@/worker/session";
import { ReviewClient } from "./review-client";
import { DiffReviewClient } from "./diff-review-client";
import { FileReviewClient } from "./file-review-client";

export default async function SessionPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const session = SessionDO.getInstance(id);
  const contentType = await session.getContentType();
  const isDone = await session.isDone();

  if (contentType === "diff") {
    const description = await session.getDescription();
    const hunks = await session.getAllHunks();
    const threads: Thread[] = await session.getThreads();
    return (
      <DiffReviewClient
        sessionId={id}
        description={description}
        hunks={hunks}
        initialThreads={threads}
        isDone={isDone}
      />
    );
  }

  if (contentType === "files") {
    const files = await session.getAllFiles();
    const threads: Thread[] = await session.getThreads();
    return (
      <FileReviewClient
        sessionId={id}
        files={files}
        initialThreads={threads}
        isDone={isDone}
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
      isDone={isDone}
    />
  );
}
