import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    globals: true,
    hookTimeout: 300_000,
    include: ["test/**/*.test.ts"],
    testTimeout: 30_000,
  },
});
