import { mkdir, readFile } from "node:fs/promises";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { ClaudeAdapter } from "../src/adapters/claude.js";
import { CodexAdapter } from "../src/adapters/codex.js";
import {
  createTaskPacket,
  createTempRoot,
  registerAdaptersTempRootCleanup,
} from "./helpers/adapters.js";
import { writeNodeBinary } from "./helpers/fake-binary.js";
import { FAKE_AGENT_TIMEOUT_MS } from "./helpers/integration.js";

registerAdaptersTempRootCleanup();

describe("agent adapters candidate runs", () => {
  it("runs Claude adapter and captures prompt/stdout/stderr artifacts", async () => {
    const root = await createTempRoot();
    const workspaceDir = join(root, "workspace");
    const logDir = join(root, "logs");
    await mkdir(workspaceDir, { recursive: true });

    const binaryPath = await writeNodeBinary(
      root,
      "fake-claude",
      `const fs = require("node:fs");
const prompt = fs.readFileSync(0, "utf8");
if (!prompt) {
  process.stderr.write("missing prompt");
  process.exit(9);
}
process.stdout.write(JSON.stringify({
  summary: prompt,
}));
process.stderr.write("claude stderr");
`,
    );

    const adapter = new ClaudeAdapter({
      binaryPath,
      timeoutMs: FAKE_AGENT_TIMEOUT_MS,
    });

    const result = await adapter.runCandidate({
      runId: "run_1",
      candidateId: "cand-01",
      strategyId: "minimal-change",
      strategyLabel: "Minimal Change",
      workspaceDir,
      logDir,
      taskPacket: createTaskPacket(),
      repairContext: {
        roundId: "impact",
        attempt: 1,
        verdicts: [
          {
            oracleId: "reviewable-output",
            status: "repairable",
            severity: "warning",
            summary: "Need stronger reviewable output.",
            repairHint: "Persist a patch or transcript.",
          },
        ],
        keyWitnesses: [
          {
            title: "Missing patch artifact",
            detail: "The previous attempt only left stderr output.",
            kind: "file",
          },
        ],
      },
    });

    expect(result.status).toBe("completed");
    expect(result.summary).toContain("Minimal Change");
    expect(result.artifacts).toEqual([
      { kind: "prompt", path: join(logDir, "prompt.txt") },
      { kind: "stdout", path: join(logDir, "claude.stdout.txt") },
      { kind: "stderr", path: join(logDir, "claude.stderr.txt") },
    ]);
    await expect(readFile(join(logDir, "prompt.txt"), "utf8")).resolves.toContain("Minimal Change");
    await expect(readFile(join(logDir, "prompt.txt"), "utf8")).resolves.toContain(
      "Repair context:",
    );
    await expect(readFile(join(logDir, "claude.stdout.txt"), "utf8")).resolves.toContain(
      '"summary":"You are generating one Oraculum candidate result.',
    );
    await expect(readFile(join(logDir, "claude.stderr.txt"), "utf8")).resolves.toContain(
      "claude stderr",
    );
  });

  it("runs Codex adapter and captures final message artifacts", async () => {
    const root = await createTempRoot();
    const workspaceDir = join(root, "workspace");
    const logDir = join(root, "logs");
    await mkdir(workspaceDir, { recursive: true });

    const binaryPath = await writeNodeBinary(
      root,
      "fake-codex",
      `const fs = require("node:fs");
const prompt = fs.readFileSync(0, "utf8");
if (!prompt) {
  process.stderr.write("missing prompt");
  process.exit(9);
}
let out = "";
for (let index = 0; index < process.argv.length; index += 1) {
  if (process.argv[index] === "-o") {
    out = process.argv[index + 1] ?? "";
  }
}
process.stdout.write('{"event":"started"}\\n');
process.stdout.write(JSON.stringify({ argv: process.argv.slice(2) }) + "\\n");
process.stderr.write("codex stderr");
if (out) {
  fs.writeFileSync(out, \`Codex finished candidate patch: \${prompt}\`, "utf8");
}
`,
    );

    const adapter = new CodexAdapter({
      binaryPath,
      timeoutMs: FAKE_AGENT_TIMEOUT_MS,
    });

    const result = await adapter.runCandidate({
      runId: "run_1",
      candidateId: "cand-02",
      strategyId: "safety-first",
      strategyLabel: "Safety First",
      workspaceDir,
      logDir,
      taskPacket: createTaskPacket(),
    });

    expect(result.status).toBe("completed");
    expect(result.summary).toContain("Safety First");
    expect(result.artifacts).toEqual([
      { kind: "prompt", path: join(logDir, "prompt.txt") },
      { kind: "transcript", path: join(logDir, "codex.stdout.jsonl") },
      { kind: "stderr", path: join(logDir, "codex.stderr.txt") },
      { kind: "report", path: join(logDir, "codex.final-message.txt") },
    ]);
    await expect(readFile(join(logDir, "codex.final-message.txt"), "utf8")).resolves.toContain(
      "Codex finished candidate patch",
    );
    await expect(readFile(join(logDir, "codex.stdout.jsonl"), "utf8")).resolves.toContain(
      '"event":"started"',
    );
    await expect(readFile(join(logDir, "codex.stdout.jsonl"), "utf8")).resolves.toContain(
      '"argv":["-a","never","exec","-s","workspace-write"',
    );
    await expect(readFile(join(logDir, "codex.stderr.txt"), "utf8")).resolves.toContain(
      "codex stderr",
    );
  });
});
