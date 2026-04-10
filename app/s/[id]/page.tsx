import { SessionDO } from "@/worker/session";
import type { Thread } from "@/worker/session";
import { DiffReviewClient } from "./diff-review-client";
import { FileReviewClient } from "./file-review-client";
import { PlaygroundClient } from "./playground-client";
import { PresentClient } from "./remark-client";
import { EncryptedShareClient } from "./encrypted-share-client";
import { EncryptedToolClient } from "./encrypted-tool-client";
import { SessionAwaitingInit } from "@/components/session-awaiting-init";

function titleForTool(toolId: string | null) {
  if (toolId === "diff") return "Diff Review";
  if (toolId === "present") return "Presentation";
  if (toolId === "playground") return "Playground";
  if (toolId === "share") return "Encrypted Share";
  return "Review";
}

function skeletonMessage(toolId: string | null) {
  if (toolId === "diff") return "The session exists. The agent still needs to upload the diff and description.";
  if (toolId === "present") return "The session exists. The agent still needs to upload the presentation.";
  if (toolId === "playground") return "The session exists. The agent still needs to upload the playground HTML.";
  if (toolId === "share") return "The session exists. The agent still needs to upload the encrypted document envelope.";
  return "The session exists. The agent still needs to upload the review files or markdown.";
}

export default async function SessionPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const session = SessionDO.getInstance(id);
  const phase = await session.getSessionPhase();
  const toolId = await session.getToolId();

  if (phase === "awaiting_init") {
    if (toolId === "share") {
      return (
        <EncryptedShareClient
          sessionId={id}
          payload=""
          isDone={false}
        />
      );
    }
    return (
      <SessionAwaitingInit
        title={titleForTool(toolId)}
        sessionId={id}
        message={skeletonMessage(toolId)}
        toolId={toolId}
      />
    );
  }

  const contentType = await session.getContentType();
  const isDone = await session.isDone();
  const encryptionMode = await session.getEncryptionMode();

  if (encryptionMode === "e2e" && toolId && toolId !== "share") {
    const data = await session.getContent();
    const threads: Thread[] = await session.getThreads();
    return (
      <EncryptedToolClient
        sessionId={id}
        toolId={toolId}
        payload={data?.content ?? ""}
        initialThreads={threads}
        isDone={isDone}
      />
    );
  }

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

  if (contentType === "present") {
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

  if (contentType === "share") {
    const data = await session.getContent();
    return (
      <EncryptedShareClient
        sessionId={id}
        payload={data?.content ?? ""}
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
