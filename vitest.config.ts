import { defineConfig } from "vitest/config";
import suiteFiles from "./scripts/test-suite-files.json" with { type: "json" };

const testMode = process.env.ORACULUM_TEST_MODE ?? "default";
const runSlowOnly = testMode === "slow";
const includeSlow = testMode === "full";
const { slowTestFiles } = suiteFiles;

export default defineConfig({
  test: {
    environment: "node",
    globals: true,
    include: runSlowOnly ? [...slowTestFiles] : ["test/**/*.test.ts"],
    exclude: includeSlow || runSlowOnly ? [] : [...slowTestFiles],
    hookTimeout: 900_000,
    maxWorkers: 4,
    testTimeout: 120_000,
  },
});
