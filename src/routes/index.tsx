import { createFileRoute } from "@tanstack/react-router";
import { HomePageContent } from "@/components/home-page-content";

export const Route = createFileRoute("/")({
  component: HomePageContent,
});
