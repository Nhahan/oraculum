import { readFile } from "node:fs/promises";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  joinPathEntries,
  resolvePackedInstallSpec,
  runOrThrow,
  writeNodeBinary,
} from "../scripts/smoke/shared-install.mjs";
import { createTempRootHarness } from "./helpers/fs.js";

const tempRootHarness = createTempRootHarness("oraculum-smoke-shared-install-");
tempRootHarness.registerCleanup();

describe("shared smoke install helpers", () => {
  it("prefers the explicit packed install spec when provided", () => {
    expect(resolvePackedInstallSpec("/repo", "/tmp/root", "/tmp/custom.tgz")).toBe(
      "/tmp/custom.tgz",
    );
  });

  it("joins PATH entries with the platform separator while dropping blanks", () => {
    const value = joinPathEntries(["/a", "", "/b"]);
    const separator = process.platform === "win32" ? ";" : ":";
    expect(value).toBe(`/a${separator}/b`);
  });

  it("returns stdout and stderr for successful commands", () => {
    const result = runOrThrow(process.execPath, ["-e", "process.stdout.write('ok')"], {
      cwd: process.cwd(),
    });

    expect(result).toEqual({
      stdout: "ok",
      stderr: "",
    });
  });

  it("throws with captured output when a command fails", () => {
    expect(() =>
      runOrThrow(
        process.execPath,
        ["-e", "process.stdout.write('so'); process.stderr.write('se'); process.exit(7)"],
        { cwd: process.cwd() },
      ),
    ).toThrow(/stdout:\nso[\s\S]*stderr:\nse/);
  });

  it("writes an executable node wrapper that forwards to the generated script", async () => {
    const root = await createTempRoot();
    const wrapperPath = await writeNodeBinary(
      root,
      "echo-smoke",
      "process.stdout.write('hello from wrapper');",
    );

    const scriptPath = join(root, "echo-smoke.cjs");
    expect(await readFile(scriptPath, "utf8")).toContain("hello from wrapper");

    if (process.platform === "win32") {
      expect(wrapperPath).toBe(join(root, "echo-smoke.cmd"));
      expect(await readFile(wrapperPath, "utf8")).toContain("echo-smoke.cjs");
    } else {
      expect(wrapperPath).toBe(join(root, "echo-smoke"));
      expect(await readFile(wrapperPath, "utf8")).toContain(`"${scriptPath}"`);
    }
  });
});

async function createTempRoot(): Promise<string> {
  return tempRootHarness.createTempRoot();
}
