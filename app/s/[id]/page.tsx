import { SessionDO } from "@/worker/session";
import type { Thread } from "@/worker/session";
import { DiffReviewClient } from "./diff-review-client";
import { FileReviewClient } from "./file-review-client";
import { PlaygroundClient } from "./playground-client";
import { PresentClient } from "./remark-client";

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
    const reviewMode = await session.getReviewMode();
    return (
      <FileReviewClient
        sessionId={id}
        files={files}
        initialThreads={threads}
        isDone={isDone}
        reviewMode={reviewMode}
      />
    );
  }

  if (contentType === "playground") {
    const data = await session.getContent();
    const threads: Thread[] = await session.getThreads();
    return (
      <PlaygroundClient
        sessionId={id}
        html={data?.content ?? ""}
        initialThreads={threads}
        isDone={isDone}
      />
    );
  }

  if (contentType === "present" || contentType === "remark") {
    const data = await session.getContent();
    const threads: Thread[] = await session.getThreads();
    return (
      <PresentClient
        sessionId={id}
        markdown={data?.content ?? ""}
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

  return (
    <FileReviewClient
      sessionId={id}
      files={[{ path: "doc.md", content: data.content }]}
      initialThreads={threads}
      isDone={isDone}
      reviewMode="doc"
    />
  );
}
