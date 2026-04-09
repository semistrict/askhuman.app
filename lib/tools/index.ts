import { registerTools } from "@/lib/tools/core";
import { reviewTool } from "@/lib/tools/review";
import { diffTool } from "@/lib/tools/diff";
import { presentTool } from "@/lib/tools/present";
import { playgroundTool } from "@/lib/tools/playground";
import { shareTool } from "@/lib/tools/share";

registerTools({
  review: reviewTool,
  diff: diffTool,
  present: presentTool,
  playground: playgroundTool,
  share: shareTool,
});

export { reviewTool, diffTool, presentTool, playgroundTool, shareTool };
