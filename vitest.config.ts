import { defineConfig } from "vitest/config";
import suiteFiles from "./scripts/test-suite-files.json" with { type: "json" };

const testMode = process.env.ORACULUM_TEST_MODE ?? "default";
const runSlowOnly = testMode === "slow";
const includeSlow = testMode === "full";
const { slowTestFiles } = suiteFiles;
const isWindowsNode18 = process.platform === "win32" && process.versions.node.startsWith("18.");

export default defineConfig({
  test: {
    environment: "node",
    globals: true,
    include: runSlowOnly ? [...slowTestFiles] : ["test/**/*.test.ts"],
    exclude: includeSlow || runSlowOnly ? [] : [...slowTestFiles],
    fileParallelism: !isWindowsNode18,
    hookTimeout: 900_000,
    maxWorkers: isWindowsNode18 ? 1 : 4,
    testTimeout: 120_000,
  },
});
