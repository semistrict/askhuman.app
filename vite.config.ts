import { cloudflare } from "@cloudflare/vite-plugin";
import vinext from "vinext";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [
    vinext(),
    cloudflare({
      persistState: false,
      viteEnvironment: { name: "rsc", childEnvironments: ["ssr"] },
    }),
  ],
});
