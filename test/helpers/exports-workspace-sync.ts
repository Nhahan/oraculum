import { mkdir } from "node:fs/promises";
import { join } from "node:path";

import {
  getCandidateDir,
  getCandidateManifestPath,
  getRunManifestPath,
} from "../../src/core/paths.js";
import { candidateManifestSchema, runManifestSchema } from "../../src/domain/run.js";
import { captureManagedProjectSnapshot } from "../../src/services/base-snapshots.js";
import { executeRun } from "../../src/services/execution.js";
import { writeJsonFile } from "../../src/services/project.js";
import { planRun } from "../../src/services/runs.js";
import { writeNodeBinary } from "./fake-binary.js";
import { FAKE_AGENT_TIMEOUT_MS } from "./integration.js";
import {
  createRecommendedSurvivorOutcomeFixture,
  createRunCandidateFixture,
  createRunManifestFixture,
} from "./run-manifest.js";

export async function runWorkspaceSyncConsultation(options: {
  cwd: string;
  codexBinaryPath: string;
  taskInput: string;
}): Promise<{ id: string }> {
  const planned = await planRun({
    cwd: options.cwd,
    taskInput: options.taskInput,
    agent: "codex",
    candidates: 1,
  });

  await executeRun({
    cwd: options.cwd,
    runId: planned.id,
    codexBinaryPath: options.codexBinaryPath,
    timeoutMs: FAKE_AGENT_TIMEOUT_MS,
  });

  return planned;
}

export async function writeSelectingCodex(
  cwd: string,
  binaryName: string,
  candidateWork: string,
  summary = "cand-01 is the recommended winner.",
): Promise<string> {
  return writeNodeBinary(
    cwd,
    binaryName,
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
        summary: ${JSON.stringify(summary)}
      }),
      "utf8",
    );
  }
  process.exit(0);
}
${candidateWork}
if (out) {
  fs.writeFileSync(out, "Codex finished candidate patch", "utf8");
}
`,
  );
}

export async function writeManualWorkspaceSyncWinner(options: {
  cwd: string;
  runId: string;
  workspaceSetup: (workspaceDir: string) => Promise<void>;
  candidateId?: string;
}): Promise<{
  baseSnapshotPath: string;
  candidateDir: string;
  candidateId: string;
  workspaceDir: string;
}> {
  const candidateId = options.candidateId ?? "cand-01";
  const candidateDir = getCandidateDir(options.cwd, options.runId, candidateId);
  const workspaceDir = join(options.cwd, ".oraculum", "workspaces", options.runId, candidateId);
  const baseSnapshotPath = join(candidateDir, "base-snapshot.json");

  await mkdir(candidateDir, { recursive: true });
  await writeJsonFile(baseSnapshotPath, await captureManagedProjectSnapshot(options.cwd));
  await mkdir(workspaceDir, { recursive: true });
  await options.workspaceSetup(workspaceDir);

  const candidate = candidateManifestSchema.parse(
    createRunCandidateFixture(candidateId, "promoted", {
      workspaceDir,
      taskPacketPath: join(candidateDir, "task-packet.json"),
      workspaceMode: "copy",
      baseSnapshotPath,
    }),
  );

  await writeJsonFile(getCandidateManifestPath(options.cwd, options.runId, candidateId), candidate);
  await writeJsonFile(
    getRunManifestPath(options.cwd, options.runId),
    runManifestSchema.parse(
      createRunManifestFixture({
        runId: options.runId,
        status: "completed",
        candidates: [candidate],
        overrides: {
          taskPath: join(options.cwd, "tasks", "task.md"),
          recommendedWinner: {
            candidateId,
            confidence: "high",
            summary: "cand-01 is the recommended winner.",
            source: "llm-judge",
          },
          outcome: createRecommendedSurvivorOutcomeFixture(),
        },
      }),
    ),
  );

  return {
    baseSnapshotPath,
    candidateDir,
    candidateId,
    workspaceDir,
  };
}
