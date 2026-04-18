import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["test/**/*.test.ts"],
  },
  resolve: {
    alias: {
      "cloudflare:workers": fileURLToPath(
        new URL("./test/helpers/cloudflare-workers-stub.ts", import.meta.url),
      ),
    },
  },
});
