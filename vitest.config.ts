import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "."),
      // See tests/stubs/server-only.ts for why this is aliased.
      "server-only": path.resolve(__dirname, "tests/stubs/server-only.ts"),
    },
  },
});
