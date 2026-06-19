import { env } from "cloudflare:workers";

export type AppCloudflareEnv = typeof env & {
  SHARE_KEYS: KVNamespace;
  UPLOAD_RATE_LIMITER?: RateLimit;
};

export const appEnv = env as AppCloudflareEnv;
