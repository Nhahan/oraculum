import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { runSubprocess } from "../src/core/subprocess.js";
import { writeNodeBinary } from "./helpers/fake-binary.js";

const tempRoots: string[] = [];

afterEach(async () => {
  await Promise.all(
    tempRoots.splice(0).map(async (path) => {
      await rm(path, { recursive: true, force: true });
    }),
  );
});

describe("subprocess execution", () => {
  it("escalates to SIGKILL after the timeout when the child ignores SIGTERM", async () => {
    const root = await createTempRoot();
    const scriptPath = await writeNodeBinary(
      root,
      "ignore-term",
      `process.on("SIGTERM", () => {});
setInterval(() => {}, 1_000);
`,
    );

    const startedAt = Date.now();
    const result = await runSubprocess({
      command: scriptPath,
      args: [],
      cwd: root,
      timeoutMs: 100,
    });

    expect(result.timedOut).toBe(true);
    expect(Date.now() - startedAt).toBeLessThan(2_000);
  });
});

async function createTempRoot(): Promise<string> {
  const path = await mkdtemp(join(tmpdir(), "oraculum-subprocess-"));
  tempRoots.push(path);
  return path;
}
