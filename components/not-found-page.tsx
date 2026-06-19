import { Link } from "@tanstack/react-router";
import { useEffect } from "react";
import { GriddedPanelBackdrop, GriddedPanelBadge } from "@/components/gridded-panel";

export function NotFoundPage() {
  useEffect(() => {
    document.title = "404 | askhuman.app";
  }, []);

  return (
    <main className="min-h-screen bg-[var(--background)] px-5 py-8 text-[var(--foreground)] sm:px-8">
      <div className="mx-auto grid min-h-[calc(100vh-4rem)] max-w-5xl content-center gap-8 lg:grid-cols-[0.95fr_1.05fr]">
        <section
          aria-label="404"
          className="relative min-h-[18rem] overflow-hidden border border-[var(--border)] bg-[var(--surface)] shadow-[8px_8px_0_var(--hard-shadow)] sm:min-h-[24rem]"
        >
          <GriddedPanelBackdrop />
          <p className="absolute bottom-8 left-5 right-5 font-mono text-[clamp(4.5rem,20vw,12rem)] font-semibold leading-none tracking-normal text-[var(--foreground)]">
            404
          </p>
          <GriddedPanelBadge>route missing</GriddedPanelBadge>
        </section>

        <section className="grid content-center border border-[var(--border)] bg-[var(--surface)] p-6 shadow-[8px_8px_0_var(--hard-shadow)]">
          <p className="font-mono text-xs uppercase text-[var(--accent)]">not found</p>
          <h1 className="mt-5 max-w-xl text-4xl font-medium leading-tight sm:text-5xl">
            Nothing lives at this address.
          </h1>
          <p className="mt-5 max-w-xl text-base leading-7 text-[var(--muted-foreground)]">
            This route is not an encrypted share, upload endpoint, or public instruction page. The
            link may be mistyped, expired, or from an old version of the site.
          </p>
          <div className="mt-7 flex flex-col gap-3 font-mono text-xs uppercase sm:flex-row">
            <Link
              to="/"
              className="inline-flex justify-center border border-[var(--border)] bg-[var(--foreground)] px-4 py-3 text-[var(--surface)] shadow-[4px_4px_0_var(--hard-shadow)] transition-transform hover:-translate-y-0.5 hover:shadow-[6px_6px_0_var(--hard-shadow)] focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[var(--accent)]"
            >
              Back to start
            </Link>
            <a
              href="/llms.txt"
              className="inline-flex justify-center border border-[var(--border)] bg-[var(--surface-muted)] px-4 py-3 text-[var(--foreground)] shadow-[4px_4px_0_var(--hard-shadow)] transition-transform hover:-translate-y-0.5 hover:shadow-[6px_6px_0_var(--hard-shadow)] focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[var(--accent)]"
            >
              Agent instructions
            </a>
          </div>
        </section>
      </div>
    </main>
  );
}
