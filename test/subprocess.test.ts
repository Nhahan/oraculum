import { readFile } from "node:fs/promises";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { runSubprocess } from "../src/core/subprocess.js";
import { writeNodeBinary } from "./helpers/fake-binary.js";
import { createTempRootHarness } from "./helpers/fs.js";

const tempRootHarness = createTempRootHarness("oraculum-subprocess-");
tempRootHarness.registerCleanup();

describe("subprocess execution", () => {
  it("escalates to SIGKILL after the timeout when the child ignores SIGTERM", async () => {
    const root = await createTempRoot();
    const startedAt = Date.now();
    const result = await runSubprocess({
      command: process.execPath,
      args: ["-e", ["process.on('SIGTERM', () => {});", "setInterval(() => {}, 1_000);"].join(" ")],
      cwd: root,
      timeoutMs: 200,
    });

    expect(result.timedOut).toBe(true);
    expect(Date.now() - startedAt).toBeLessThan(2_000);
  });

  it("bounds stdout and stderr capture while preserving truncation flags", async () => {
    const root = await createTempRoot();
    const scriptPath = await writeNodeBinary(
      root,
      "large-output",
      `process.stdout.write("x".repeat(32));
process.stderr.write("y".repeat(32));
`,
    );

    const result = await runSubprocess({
      command: scriptPath,
      args: [],
      cwd: root,
      maxOutputBytes: 8,
    });

    expect(result.stdout).toBe("x".repeat(8));
    expect(result.stderr).toBe("y".repeat(8));
    expect(result.stdoutTruncated).toBe(true);
    expect(result.stderrTruncated).toBe(true);
  });

  it("does not inherit host env when inheritEnv is false", async () => {
    const root = await createTempRoot();
    const scriptPath = await writeNodeBinary(
      root,
      "env-isolation",
      [
        "if (process.env.ORACULUM_SUBPROCESS_SECRET) {",
        "  process.stderr.write('leaked');",
        "  process.exit(2);",
        "}",
      ].join("\n"),
    );

    const originalSecret = process.env.ORACULUM_SUBPROCESS_SECRET;
    process.env.ORACULUM_SUBPROCESS_SECRET = "should-not-leak";
    try {
      const result = await runSubprocess({
        command: scriptPath,
        args: [],
        cwd: root,
        env: {},
        inheritEnv: false,
      });

      expect(result.exitCode).toBe(0);
      expect(result.stderr).toBe("");
    } finally {
      if (originalSecret === undefined) {
        delete process.env.ORACULUM_SUBPROCESS_SECRET;
      } else {
        process.env.ORACULUM_SUBPROCESS_SECRET = originalSecret;
      }
    }
  });

  const posixIt = process.platform === "win32" ? it.skip : it;

  posixIt("terminates the subprocess process group on timeout", async () => {
    const root = await createTempRoot();
    const markerPath = join(root, "grandchild-survived.txt");
    const result = await runSubprocess({
      command: process.execPath,
      args: [
        "-e",
        [
          "const { spawn } = require('node:child_process');",
          `spawn(process.execPath, ["-e", ${JSON.stringify(
            [
              `setTimeout(() => require('node:fs').writeFileSync(${JSON.stringify(markerPath)}, 'alive'), 1_000);`,
              "setInterval(() => {}, 1_000);",
            ].join(" "),
          )}], { stdio: 'ignore' });`,
          "process.on('SIGTERM', () => {});",
          "setInterval(() => {}, 1_000);",
        ].join(" "),
      ],
      cwd: root,
      timeoutMs: 200,
    });
    await new Promise((resolve) => setTimeout(resolve, 1_100));

    expect(result.timedOut).toBe(true);
    await expect(readFile(markerPath)).rejects.toThrow();
  });
});

async function createTempRoot(): Promise<string> {
  return tempRootHarness.createTempRoot();
}
