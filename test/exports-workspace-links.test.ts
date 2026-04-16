import { chmod, lstat, readlink, stat, symlink, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { describe, expect, it } from "vitest";
import { executeRun } from "../src/services/execution.js";
import { materializeExport } from "../src/services/exports.js";
import { initializeProject } from "../src/services/project.js";
import { planRun } from "../src/services/runs.js";
import { createTempRoot } from "./helpers/exports.js";
import { writeNodeBinary } from "./helpers/fake-binary.js";
import {
  EXPORT_WORKSPACE_LINKS_TEST_TIMEOUT_MS,
  FAKE_AGENT_TIMEOUT_MS,
} from "./helpers/integration.js";

describe("materialized exports", () => {
  it.skipIf(process.platform === "win32")(
    "preserves executable mode changes during workspace-sync export",
    async () => {
      const cwd = await createTempRoot();
      await initializeProject({ cwd, force: false });
      await writeFile(join(cwd, "tool.sh"), "#!/bin/sh\necho ok\n", "utf8");
      await chmod(join(cwd, "tool.sh"), 0o644);

      const fakeCodex = await writeNodeBinary(
        cwd,
        "fake-codex",
        `const fs = require("node:fs");
const path = require("node:path");
const prompt = fs.readFileSync(0, "utf8");
let out = "";
for (let index = 0; index < process.argv.length; index += 1) {
  if (process.argv[index] === "-o") {
    out = process.argv[index + 1] ?? "";
  }
}
if (prompt.includes("You are selecting the best Oraculum finalist.")) {
  if (out) {
    fs.writeFileSync(
      out,
      JSON.stringify({
        decision: "select",
        candidateId: "cand-01",
        confidence: "high",
        summary: "cand-01 is the recommended winner."
      }),
      "utf8",
    );
  }
  process.exit(0);
}
fs.chmodSync(path.join(process.cwd(), "tool.sh"), 0o755);
if (out) {
  fs.writeFileSync(out, "Codex finished candidate patch", "utf8");
}
`,
      );

      const planned = await planRun({
        cwd,
        taskInput: "preserve executable mode",
        agent: "codex",
        candidates: 1,
      });

      await executeRun({
        cwd,
        runId: planned.id,
        codexBinaryPath: fakeCodex,
        timeoutMs: FAKE_AGENT_TIMEOUT_MS,
      });

      await materializeExport({
        cwd,
        branchName: "fix/session-loss",
        withReport: false,
      });

      expect((await stat(join(cwd, "tool.sh"))).mode & 0o777).toBe(0o755);
    },
    EXPORT_WORKSPACE_LINKS_TEST_TIMEOUT_MS,
  );

  it.skipIf(process.platform === "win32")(
    "preserves symlinks during workspace-sync export",
    async () => {
      const cwd = await createTempRoot();
      await initializeProject({ cwd, force: false });
      await writeFile(join(cwd, "target.txt"), "target\n", "utf8");
      await symlink("target.txt", join(cwd, "linked.txt"));

      const fakeCodex = await writeNodeBinary(
        cwd,
        "fake-codex",
        `const fs = require("node:fs");
const path = require("node:path");
const prompt = fs.readFileSync(0, "utf8");
let out = "";
for (let index = 0; index < process.argv.length; index += 1) {
  if (process.argv[index] === "-o") {
    out = process.argv[index + 1] ?? "";
  }
}
if (prompt.includes("You are selecting the best Oraculum finalist.")) {
  if (out) {
    fs.writeFileSync(
      out,
      JSON.stringify({
        decision: "select",
        candidateId: "cand-01",
        confidence: "high",
        summary: "cand-01 is the recommended winner."
      }),
      "utf8",
    );
  }
  process.exit(0);
}
const linkedPath = path.join(process.cwd(), "linked.txt");
try {
  fs.rmSync(linkedPath, { force: true });
} catch {}
fs.writeFileSync(path.join(process.cwd(), "target-next.txt"), "target next\\n", "utf8");
fs.symlinkSync("target-next.txt", linkedPath);
if (out) {
  fs.writeFileSync(out, "Codex finished candidate patch", "utf8");
}
`,
      );

      const planned = await planRun({
        cwd,
        taskInput: "fix session loss on refresh",
        agent: "codex",
        candidates: 1,
      });

      await executeRun({
        cwd,
        runId: planned.id,
        codexBinaryPath: fakeCodex,
        timeoutMs: FAKE_AGENT_TIMEOUT_MS,
      });

      await materializeExport({
        cwd,
        branchName: "fix/session-loss",
        withReport: false,
      });

      const linkedStats = await lstat(join(cwd, "linked.txt"));
      expect(linkedStats.isSymbolicLink()).toBe(true);
      expect(await readlink(join(cwd, "linked.txt"))).toBe("target-next.txt");
    },
    EXPORT_WORKSPACE_LINKS_TEST_TIMEOUT_MS,
  );
});
