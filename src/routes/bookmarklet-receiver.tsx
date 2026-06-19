import { createFileRoute } from "@tanstack/react-router";
import { BookmarkletReceiver } from "@/components/bookmarklet-receiver";

export const Route = createFileRoute("/bookmarklet-receiver")({
  component: BookmarkletReceiver,
});
