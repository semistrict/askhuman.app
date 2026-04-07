import { describe, expect, it } from "vitest";
import {
  parseDiffToHunks,
  parseAndValidateDiff,
  createStableHunkId,
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

const TWO_HUNK_DIFF = `diff --git a/a.ts b/a.ts
--- a/a.ts
+++ b/a.ts
@@ -1 +1 @@
-old
+new
diff --git a/b.ts b/b.ts
--- a/b.ts
+++ b/b.ts
@@ -1 +1 @@
-x
+y
`;

describe("diff parsing", () => {
  it("parses a simple diff into hunks", () => {
    const hunks = parseDiffToHunks(SIMPLE_DIFF);
    expect(hunks).toHaveLength(1);
    expect(hunks[0].filePath).toBe("foo.ts");
    expect(hunks[0].oldStart).toBe(1);
    expect(hunks[0].oldCount).toBe(3);
    expect(hunks[0].newStart).toBe(1);
    expect(hunks[0].newCount).toBe(4);
    expect(hunks[0].content).toContain("+const z = 4;");
  });

  it("parses a diff with two files into separate hunks", () => {
    const hunks = parseDiffToHunks(TWO_HUNK_DIFF);
    expect(hunks).toHaveLength(2);
    expect(hunks[0].filePath).toBe("a.ts");
    expect(hunks[1].filePath).toBe("b.ts");
  });

  it("produces stable hunk IDs based on file path and content", () => {
    const hunks = parseDiffToHunks(SIMPLE_DIFF);
    const id1 = createStableHunkId(hunks[0]);
    const id2 = createStableHunkId(hunks[0]);
    expect(id1).toBe(id2);
    expect(id1).toMatch(/^[A-Za-z0-9_-]+$/);
  });

  it("produces different IDs for different hunks", () => {
    const hunks = parseDiffToHunks(TWO_HUNK_DIFF);
    const id1 = createStableHunkId(hunks[0]);
    const id2 = createStableHunkId(hunks[1]);
    expect(id1).not.toBe(id2);
  });
});

describe("diff validation", () => {
  it("throws on empty diff", () => {
    expect(() => parseAndValidateDiff("")).toThrow(RequestHunksValidationError);
    expect(() => parseAndValidateDiff("  ")).toThrow(RequestHunksValidationError);
  });

  it("throws on diff with no parseable hunks", () => {
    expect(() => parseAndValidateDiff("not a diff")).toThrow(RequestHunksValidationError);
  });

  it("returns parsed hunks for valid diff", () => {
    const hunks = parseAndValidateDiff(SIMPLE_DIFF);
    expect(hunks).toHaveLength(1);
    expect(hunks[0].filePath).toBe("foo.ts");
  });
});
