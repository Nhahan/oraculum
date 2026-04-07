import { mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { ClaudeAdapter } from "../src/adapters/claude.js";
import { CodexAdapter } from "../src/adapters/codex.js";
import { materializedTaskPacketSchema } from "../src/domain/task.js";
import { writeNodeBinary } from "./helpers/fake-binary.js";

const tempRoots: string[] = [];

afterEach(async () => {
  await Promise.all(
    tempRoots.splice(0).map(async (path) => {
      await rm(path, { recursive: true, force: true });
    }),
  );
});

describe("agent adapters", () => {
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
      timeoutMs: 5_000,
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
    await expect(readFile(join(logDir, "prompt.txt"), "utf8")).resolves.toContain("Minimal Change");
    await expect(readFile(join(logDir, "prompt.txt"), "utf8")).resolves.toContain(
      "Repair context:",
    );
    await expect(readFile(join(logDir, "claude.stdout.txt"), "utf8")).resolves.toContain(
      '"summary":"You are generating one Oraculum patch candidate.',
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
      timeoutMs: 5_000,
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

  it("asks Codex to recommend a winner and parses structured output", async () => {
    const root = await createTempRoot();
    const logDir = join(root, "judge-logs");

    const binaryPath = await writeNodeBinary(
      root,
      "fake-codex",
      `const fs = require("node:fs");
fs.readFileSync(0, "utf8");
let out = "";
for (let index = 0; index < process.argv.length; index += 1) {
  if (process.argv[index] === "-o") {
    out = process.argv[index + 1] ?? "";
  }
}
process.stdout.write('{"event":"started"}\\n');
if (out) {
  fs.writeFileSync(
    out,
    '{"candidateId":"cand-02","confidence":"medium","summary":"cand-02 preserved the strongest evidence."}',
    "utf8",
  );
}
`,
    );

    const adapter = new CodexAdapter({
      binaryPath,
      timeoutMs: 5_000,
    });

    const result = await adapter.recommendWinner({
      runId: "run_1",
      projectRoot: root,
      logDir,
      taskPacket: createTaskPacket(),
      finalists: [
        {
          candidateId: "cand-01",
          strategyLabel: "Minimal Change",
          summary: "Small diff.",
          artifactKinds: ["report"],
          changedPaths: ["src/auth/session.ts"],
          changeSummary: {
            mode: "git-diff",
            changedPathCount: 1,
            createdPathCount: 0,
            removedPathCount: 0,
            modifiedPathCount: 1,
            addedLineCount: 8,
            deletedLineCount: 2,
          },
          witnessRollup: {
            witnessCount: 1,
            warningOrHigherCount: 1,
            repairableCount: 0,
            repairHints: [],
            riskSummaries: ["Touches auth session restoration."],
            keyWitnesses: [
              {
                roundId: "impact",
                oracleId: "api-impact",
                kind: "command-output",
                title: "Auth flow touched",
                detail: "Session restore path changed.",
              },
            ],
          },
          repairSummary: {
            attemptCount: 0,
            repairedRounds: [],
          },
          verdicts: [],
        },
        {
          candidateId: "cand-02",
          strategyLabel: "Safety First",
          summary: "More evidence.",
          artifactKinds: ["report", "transcript"],
          changedPaths: ["src/auth/session.ts", "test/auth/session.test.ts"],
          changeSummary: {
            mode: "git-diff",
            changedPathCount: 2,
            createdPathCount: 1,
            removedPathCount: 0,
            modifiedPathCount: 1,
            addedLineCount: 14,
            deletedLineCount: 3,
          },
          witnessRollup: {
            witnessCount: 2,
            warningOrHigherCount: 1,
            repairableCount: 1,
            repairHints: ["Persist a clearer patch summary."],
            riskSummaries: ["Public API drift needs review."],
            keyWitnesses: [
              {
                roundId: "impact",
                oracleId: "reviewable-output",
                kind: "file",
                title: "Reviewable output",
                detail: "Transcript and patch were captured.",
              },
            ],
          },
          repairSummary: {
            attemptCount: 1,
            repairedRounds: ["impact"],
          },
          verdicts: [],
        },
      ],
    });

    expect(result.status).toBe("completed");
    expect(result.recommendation?.candidateId).toBe("cand-02");
    expect(result.recommendation?.confidence).toBe("medium");
    await expect(
      readFile(join(logDir, "winner-judge.final-message.txt"), "utf8"),
    ).resolves.toContain('"candidateId":"cand-02"');
    await expect(readFile(join(logDir, "winner-judge.prompt.txt"), "utf8")).resolves.toContain(
      "Change summary: mode=git-diff, changed=2, created=1, removed=0, modified=1, +14, -3",
    );
    await expect(readFile(join(logDir, "winner-judge.prompt.txt"), "utf8")).resolves.toContain(
      "Repair summary: attempts=1, rounds=impact",
    );
  });

  it("asks Codex to recommend a consultation profile with an output schema", async () => {
    const root = await createTempRoot();
    const logDir = join(root, "profile-logs");

    const binaryPath = await writeNodeBinary(
      root,
      "fake-codex",
      `const fs = require("node:fs");
let out = "";
let schema = "";
for (let index = 0; index < process.argv.length; index += 1) {
  if (process.argv[index] === "-o") {
    out = process.argv[index + 1] ?? "";
  }
  if (process.argv[index] === "--output-schema") {
    schema = process.argv[index + 1] ?? "";
  }
}
process.stdout.write(JSON.stringify({ argv: process.argv.slice(2), schema }) + "\\n");
if (out) {
  fs.writeFileSync(
    out,
    '{"profileId":"library","confidence":"high","summary":"Library signals are strongest.","candidateCount":4,"strategyIds":["minimal-change","test-amplified"],"selectedCommandIds":["lint-fast","typecheck-fast"],"missingCapabilities":[]}',
    "utf8",
  );
}
`,
    );

    const adapter = new CodexAdapter({
      binaryPath,
      timeoutMs: 5_000,
    });

    const result = await adapter.recommendProfile({
      runId: "run_1",
      projectRoot: root,
      logDir,
      taskPacket: createTaskPacket(),
      signals: {
        packageManager: "npm",
        scripts: ["lint", "typecheck", "test"],
        dependencies: ["typescript"],
        files: ["package.json", "tsconfig.json"],
        tags: ["package-export", "lint-script", "typecheck-script"],
        notes: [],
        commandCatalog: [
          {
            id: "lint-fast",
            roundId: "fast",
            label: "Lint",
            command: "npm",
            args: ["run", "lint"],
            invariant: "The codebase should satisfy lint checks.",
          },
          {
            id: "typecheck-fast",
            roundId: "fast",
            label: "Typecheck",
            command: "npm",
            args: ["run", "typecheck"],
            invariant: "The codebase should satisfy type checking.",
          },
        ],
      },
      profileOptions: [
        { id: "library", description: "Library work." },
        { id: "frontend", description: "Frontend work." },
        { id: "migration", description: "Migration work." },
      ],
    });

    expect(result.status).toBe("completed");
    expect(result.recommendation?.profileId).toBe("library");
    expect(result.recommendation?.selectedCommandIds).toEqual(["lint-fast", "typecheck-fast"]);
    await expect(readFile(join(logDir, "profile-judge.prompt.txt"), "utf8")).resolves.toContain(
      "Profile options:",
    );
    await expect(readFile(join(logDir, "profile-judge.stdout.jsonl"), "utf8")).resolves.toContain(
      '"--output-schema"',
    );
  });

  it("asks Claude to recommend a consultation profile with json-schema output", async () => {
    const root = await createTempRoot();
    const logDir = join(root, "profile-logs");

    const binaryPath = await writeNodeBinary(
      root,
      "fake-claude",
      `process.stdout.write(JSON.stringify({
  profileId: "frontend",
  confidence: "medium",
  summary: "Frontend build and e2e signals are present.",
  candidateCount: 4,
  strategyIds: ["minimal-change", "safety-first"],
  selectedCommandIds: ["build-impact", "e2e-deep"],
  missingCapabilities: [],
}));`,
    );

    const adapter = new ClaudeAdapter({
      binaryPath,
      timeoutMs: 5_000,
    });

    const result = await adapter.recommendProfile({
      runId: "run_1",
      projectRoot: root,
      logDir,
      taskPacket: createTaskPacket(),
      signals: {
        packageManager: "pnpm",
        scripts: ["build", "e2e"],
        dependencies: ["react", "vite"],
        files: ["package.json", "vite.config.ts", "playwright.config.ts"],
        tags: ["frontend-framework", "frontend-build", "e2e-config"],
        notes: [],
        commandCatalog: [
          {
            id: "build-impact",
            roundId: "impact",
            label: "Build",
            command: "pnpm",
            args: ["run", "build"],
            invariant: "The project should build successfully after the patch.",
          },
          {
            id: "e2e-deep",
            roundId: "deep",
            label: "End-to-end checks",
            command: "pnpm",
            args: ["run", "e2e"],
            invariant: "Deep end-to-end validation should pass.",
          },
        ],
      },
      profileOptions: [
        { id: "library", description: "Library work." },
        { id: "frontend", description: "Frontend work." },
        { id: "migration", description: "Migration work." },
      ],
    });

    expect(result.status).toBe("completed");
    expect(result.recommendation?.profileId).toBe("frontend");
    await expect(readFile(join(logDir, "profile-judge.prompt.txt"), "utf8")).resolves.toContain(
      "Command catalog:",
    );
  });
});

function createTaskPacket() {
  return materializedTaskPacketSchema.parse({
    id: "fix-session-loss",
    title: "Fix session loss",
    intent: "Preserve login state during refresh.",
    source: {
      kind: "task-note",
      path: "/tmp/task.md",
    },
  });
}

async function createTempRoot(): Promise<string> {
  const path = await mkdtemp(join(tmpdir(), "oraculum-adapters-"));
  tempRoots.push(path);
  return path;
}
