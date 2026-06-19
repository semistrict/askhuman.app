import { buildRootPlainText, detectRootPlainRecipe } from "@/lib/root-plain";

export async function GET(request: Request) {
  const baseUrl = new URL("/", request.url).toString().replace(/\/$/, "");
  const text = buildRootPlainText(baseUrl, { recipe: detectRootPlainRecipe(request) });
  return new Response(text.endsWith("\n") ? text : `${text}\n`, {
    headers: { "Content-Type": "text/plain; charset=utf-8" },
  });
}
