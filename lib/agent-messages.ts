import { parse } from "yaml";
import planYaml from "@/lib/messages/plan.yaml?raw";
import diffYaml from "@/lib/messages/diff.yaml?raw";
import filesYaml from "@/lib/messages/files.yaml?raw";
import playgroundYaml from "@/lib/messages/playground.yaml?raw";
import sharedYaml from "@/lib/messages/shared.yaml?raw";

const parsed: Record<string, string> = {
  ...(parse(sharedYaml) as Record<string, string>),
  ...(parse(planYaml) as Record<string, string>),
  ...(parse(diffYaml) as Record<string, string>),
  ...(parse(filesYaml) as Record<string, string>),
  ...(parse(playgroundYaml) as Record<string, string>),
};

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
