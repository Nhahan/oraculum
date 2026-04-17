import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

import type { RunManifest } from "../../src/domain/run.js";
import { writeNodeBinary } from "./fake-binary.js";
import {
  createInitializedProject,
  createTempProject,
  registerProjectTempRootCleanup,
} from "./project.js";
import { writeRunManifest } from "./run-artifacts.js";
import {
  createRecommendedSurvivorOutcomeFixture,
  createRunCandidateFixture,
  createRunManifestFixture,
  createTaskPacketFixture,
} from "./run-manifest.js";

type ProjectFlowCandidate = Partial<RunManifest["candidates"][number]>;
type ProjectFlowTaskPacket = Partial<RunManifest["taskPacket"]>;
type ProjectFlowOutcome = Partial<NonNullable<RunManifest["outcome"]>>;
type ProjectFlowRecommendedWinner = Partial<NonNullable<RunManifest["recommendedWinner"]>>;
type ProjectFlowManifest = Partial<
  Omit<RunManifest, "candidates" | "taskPacket" | "outcome" | "recommendedWinner">
>;

const DEFAULT_CREATED_AT = "2026-04-06T00:00:00.000Z";

export {
  createInitializedProject,
  createTempProject,
  registerProjectTempRootCleanup as registerProjectFlowsTempRootCleanup,
};

export async function writeProjectFlowFile(
  cwd: string,
  relativePath: string,
  contents: string,
): Promise<void> {
  const targetPath = join(cwd, relativePath);
  await mkdir(dirname(targetPath), { recursive: true });
  await writeFile(targetPath, contents, "utf8");
}

export async function writeProjectFlowManifest(cwd: string, manifest: RunManifest): Promise<void> {
  await writeRunManifest(cwd, manifest);
}

export async function createStaticOutputCodexBinary(
  cwd: string,
  output: string,
  name = "fake-codex",
): Promise<string> {
  return writeNodeBinary(
    cwd,
    name,
    `const fs = require("node:fs");
let out = "";
for (let index = 0; index < process.argv.length; index += 1) {
  if (process.argv[index] === "-o") {
    out = process.argv[index + 1] ?? "";
  }
}
if (out) {
  fs.writeFileSync(out, ${JSON.stringify(output)}, "utf8");
}
`,
  );
}

export async function createWinnerSelectingCodexBinary(
  cwd: string,
  name = "fake-codex",
): Promise<string> {
  return writeNodeBinary(
    cwd,
    name,
    `const fs = require("node:fs");
const path = require("node:path");
const prompt = fs.readFileSync(0, "utf8");
let out = "";
for (let index = 0; index < process.argv.length; index += 1) {
  if (process.argv[index] === "-o") {
    out = process.argv[index + 1] ?? "";
  }
}
if (out) {
  const body = prompt.includes("You are selecting the best Oraculum finalist.")
    ? '{"decision":"select","candidateId":"cand-01","confidence":"high","summary":"cand-01 is the recommended promotion."}'
    : "Codex finished candidate patch";
  if (!prompt.includes("You are selecting the best Oraculum finalist.")) {
    fs.writeFileSync(path.join(process.cwd(), "candidate-change.txt"), "patched\\n", "utf8");
  }
  fs.writeFileSync(out, body, "utf8");
}
`,
  );
}

function createCandidatePaths(
  cwd: string,
  runId: string,
  candidateId: string,
): {
  workspaceDir: string;
  taskPacketPath: string;
} {
  return {
    workspaceDir: join(cwd, ".oraculum", "runs", runId, candidateId, "workspace"),
    taskPacketPath: join(cwd, ".oraculum", "runs", runId, candidateId, "task-packet.json"),
  };
}

export function createRecommendedProjectFlowManifest(
  cwd: string,
  runId: string,
  options: {
    candidateId?: string;
    candidateStatus?: RunManifest["candidates"][number]["status"];
    candidateOverrides?: ProjectFlowCandidate;
    taskPacketOverrides?: ProjectFlowTaskPacket;
    outcomeOverrides?: ProjectFlowOutcome;
    recommendedWinnerOverrides?: ProjectFlowRecommendedWinner;
    manifestOverrides?: ProjectFlowManifest;
    includeRecommendedWinner?: boolean;
  } = {},
): RunManifest {
  const candidateId = options.candidateId ?? "cand-01";
  const candidate = createRunCandidateFixture(candidateId, options.candidateStatus ?? "promoted", {
    ...createCandidatePaths(cwd, runId, candidateId),
    createdAt: DEFAULT_CREATED_AT,
    ...options.candidateOverrides,
  });

  const manifest = createRunManifestFixture({
    runId,
    status: "completed",
    candidates: [candidate],
    overrides: {
      taskPath: join(cwd, "tasks", "flow-task.md"),
      taskPacket: createTaskPacketFixture({
        sourcePath: join(cwd, "tasks", "flow-task.md"),
        ...options.taskPacketOverrides,
      }),
      createdAt: DEFAULT_CREATED_AT,
      updatedAt: DEFAULT_CREATED_AT,
      outcome: createRecommendedSurvivorOutcomeFixture({
        recommendedCandidateId: candidateId,
        ...options.outcomeOverrides,
      }),
      ...options.manifestOverrides,
    },
  });

  if (options.includeRecommendedWinner === false) {
    return manifest;
  }

  return {
    ...manifest,
    recommendedWinner: {
      candidateId,
      confidence: "high",
      summary: `${candidateId} is the recommended promotion.`,
      source: "llm-judge",
      ...options.recommendedWinnerOverrides,
    },
  };
}

export function createFinalistsWithoutRecommendationProjectFlowManifest(
  cwd: string,
  runId: string,
  options: {
    candidateId?: string;
    candidateStatus?: RunManifest["candidates"][number]["status"];
    candidateOverrides?: ProjectFlowCandidate;
    taskPacketOverrides?: ProjectFlowTaskPacket;
    outcomeOverrides?: ProjectFlowOutcome;
    manifestOverrides?: ProjectFlowManifest;
  } = {},
): RunManifest {
  const candidateId = options.candidateId ?? "cand-01";
  const candidate = createRunCandidateFixture(candidateId, options.candidateStatus ?? "promoted", {
    ...createCandidatePaths(cwd, runId, candidateId),
    createdAt: DEFAULT_CREATED_AT,
    ...options.candidateOverrides,
  });

  return createRunManifestFixture({
    runId,
    status: "completed",
    candidates: [candidate],
    overrides: {
      taskPath: join(cwd, "tasks", "flow-task.md"),
      taskPacket: createTaskPacketFixture({
        sourcePath: join(cwd, "tasks", "flow-task.md"),
        ...options.taskPacketOverrides,
      }),
      createdAt: DEFAULT_CREATED_AT,
      updatedAt: DEFAULT_CREATED_AT,
      outcome: {
        type: "finalists-without-recommendation",
        terminal: true,
        crownable: false,
        finalistCount: 1,
        validationPosture: "sufficient",
        verificationLevel: "lightweight",
        validationGapCount: 0,
        judgingBasisKind: "unknown",
        ...options.outcomeOverrides,
      },
      ...options.manifestOverrides,
    },
  });
}
