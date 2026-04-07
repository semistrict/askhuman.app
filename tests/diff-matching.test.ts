import { describe, expect, it } from "vitest";
import {
  prepareDiffReviewRequest,
  RequestHunksValidationError,
} from "../lib/diff-matching";

const SIMPLE_DIFF = `diff --git a/foo.ts b/foo.ts
index 1234567..abcdef0 100644
--- a/foo.ts
+++ b/foo.ts
@@ -1,3 +1,4 @@
 const x = 1;
-const y = 2;
+const y = 3;
+const z = 4;
 export { x };
`;

const CONTEXT_HEADER_DIFF = `diff --git a/docs.md b/docs.md
--- a/docs.md
+++ b/docs.md
@@ -1,2 +1,2 @@ usage example
-before
+after
 keep
`;

const DUPLICATE_HUNK_DIFF = `diff --git a/a.ts b/a.ts
--- a/a.ts
+++ b/a.ts
@@ -1 +1 @@
-old
+new
diff --git a/b.ts b/b.ts
--- a/b.ts
+++ b/b.ts
@@ -1 +1 @@
-old
+new
`;

describe("diff patch matching", () => {
  it("matches a patch block using file path plus normalized hunk header", () => {
    const result = prepareDiffReviewRequest(
      `# Review

\`\`\`patch docs.md @@ -1,2 +1,2 @@
-before
+after
\`\`\`
`,
      CONTEXT_HEADER_DIFF
    );

    expect(result.selectedHunks).toHaveLength(1);
    expect(result.selectedHunks[0].filePath).toBe("docs.md");
    expect(result.selectedHunks[0].header).toBe("@@ -1,2 +1,2 @@ usage example");
  });

  it("returns a prescriptive no-match error with a suggested fence", () => {
    expect(() =>
      prepareDiffReviewRequest(
        `# Review

\`\`\`patch
diff --git a/foo.ts b/foo.ts
index 1234567..abcdef0 100644
--- a/foo.ts
+++ b/foo.ts
@@ -1,3 +1,4 @@
\`\`\`
`,
        SIMPLE_DIFF
      )
    ).toThrowError(RequestHunksValidationError);

    try {
      prepareDiffReviewRequest(
        `# Review

\`\`\`patch
diff --git a/foo.ts b/foo.ts
index 1234567..abcdef0 100644
--- a/foo.ts
+++ b/foo.ts
@@ -1,3 +1,4 @@
\`\`\`
`,
        SIMPLE_DIFF
      );
    } catch (error) {
      expect(error).toBeInstanceOf(RequestHunksValidationError);
      const message = (error as RequestHunksValidationError).message;
      expect(message).toContain("Do not include diff --git");
      expect(message).toContain("Closest matching hunks you could submit");
      expect(message).toContain("```patch foo.ts @@ -1,3 +1,4 @@");
    }
  });

  it("normalizes suggested headers by dropping trailing context text", () => {
    try {
      prepareDiffReviewRequest(
        `# Review

\`\`\`patch docs.md @@ -1,2 +1,2 @@
missing
\`\`\`
`,
        CONTEXT_HEADER_DIFF
      );
    } catch (error) {
      expect(error).toBeInstanceOf(RequestHunksValidationError);
      const message = (error as RequestHunksValidationError).message;
      expect(message).toContain("```patch docs.md @@ -1,2 +1,2 @@");
      expect(message).not.toContain("@@ -1,2 +1,2 @@ usage example");
      return;
    }

    throw new Error("expected prepareDiffReviewRequest to throw");
  });

  it("rejects ambiguous patch blocks that match multiple hunks", () => {
    expect(() =>
      prepareDiffReviewRequest(
        `# Review

\`\`\`patch
-old
+new
\`\`\`
`,
        DUPLICATE_HUNK_DIFF
      )
    ).toThrowError(/matched 2 hunks/);
  });
});
