import { parse } from "yaml";
import rawYaml from "@/lib/agent-messages.yaml?raw";

const parsed = parse(rawYaml) as Record<string, string>;

export function msg(
  key: string,
  vars: Record<string, string | number> = {}
): string {
  const template = parsed[key];
  if (!template) {
    throw new Error(`Unknown agent message key: ${key}`);
  }
  let result = template.trimEnd();
  for (const [name, value] of Object.entries(vars)) {
    result = result.replaceAll(`{${name}}`, String(value));
  }
  return result;
}
