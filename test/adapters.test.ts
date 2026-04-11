import { mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { ClaudeAdapter } from "../src/adapters/claude.js";
import { CodexAdapter } from "../src/adapters/codex.js";
import { buildProfileSelectionPrompt } from "../src/adapters/prompt.js";
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
process.stdout.write(JSON.stringify({ event: "started", argv: process.argv.slice(2) }) + "\\n");
if (out) {
  fs.writeFileSync(
    out,
    '{"decision":"select","candidateId":"cand-02","confidence":"medium","summary":"cand-02 preserved the strongest evidence."}',
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
    ).resolves.toContain('"decision":"select"');
    await expect(readFile(join(logDir, "winner-judge.stdout.jsonl"), "utf8")).resolves.toContain(
      '"--output-schema"',
    );
    await expect(readFile(join(logDir, "winner-judge.stdout.jsonl"), "utf8")).resolves.toContain(
      '"read-only"',
    );
    await expect(readFile(join(logDir, "winner-judge.prompt.txt"), "utf8")).resolves.toContain(
      "Change summary: mode=git-diff, changed=2, created=1, removed=0, modified=1, +14, -3",
    );
    await expect(readFile(join(logDir, "winner-judge.prompt.txt"), "utf8")).resolves.toContain(
      "Repair summary: attempts=1, rounds=impact",
    );
  }, 20_000);

  it("includes consultation profile gaps in winner-selection prompts", async () => {
    const root = await createTempRoot();
    const logDir = join(root, "judge-profile-gap-logs");

    const binaryPath = await writeNodeBinary(
      root,
      "fake-codex",
      `const fs = require("node:fs");
let out = "";
for (let index = 0; index < process.argv.length; index += 1) {
  if (process.argv[index] === "-o") {
    out = process.argv[index + 1] ?? "";
  }
}
if (out) {
  fs.writeFileSync(
    out,
    '{"decision":"abstain","confidence":"low","summary":"Deep validation is incomplete."}',
    "utf8",
  );
}
`,
    );

    const adapter = new CodexAdapter({
      binaryPath,
      timeoutMs: 5_000,
    });

    await adapter.recommendWinner({
      runId: "run_1",
      projectRoot: root,
      logDir,
      taskPacket: createTaskPacket(),
      consultationProfile: {
        profileId: "frontend",
        confidence: "medium",
        summary: "Frontend signals are strongest.",
        missingCapabilities: ["No e2e or visual deep check was detected."],
      },
      finalists: [
        {
          candidateId: "cand-01",
          strategyLabel: "Minimal Change",
          summary: "Small diff.",
          artifactKinds: ["report"],
          changedPaths: ["src/page.tsx"],
          changeSummary: {
            mode: "git-diff",
            changedPathCount: 1,
            createdPathCount: 0,
            removedPathCount: 0,
            modifiedPathCount: 1,
            addedLineCount: 4,
            deletedLineCount: 1,
          },
          witnessRollup: {
            witnessCount: 0,
            warningOrHigherCount: 0,
            repairableCount: 0,
            repairHints: [],
            riskSummaries: [],
            keyWitnesses: [],
          },
          repairSummary: {
            attemptCount: 0,
            repairedRounds: [],
          },
          verdicts: [],
        },
      ],
    });

    await expect(readFile(join(logDir, "winner-judge.prompt.txt"), "utf8")).resolves.toContain(
      "Consultation profile: frontend (medium)",
    );
    await expect(readFile(join(logDir, "winner-judge.prompt.txt"), "utf8")).resolves.toContain(
      "No e2e or visual deep check was detected.",
    );
  });

  it("parses a structured abstention from Codex winner selection", async () => {
    const root = await createTempRoot();
    const logDir = join(root, "judge-abstain-logs");

    const binaryPath = await writeNodeBinary(
      root,
      "fake-codex",
      `const fs = require("node:fs");
let out = "";
for (let index = 0; index < process.argv.length; index += 1) {
  if (process.argv[index] === "-o") {
    out = process.argv[index + 1] ?? "";
  }
}
if (out) {
  fs.writeFileSync(
    out,
    '{"decision":"abstain","confidence":"low","summary":"The finalists are too weak to recommend safely."}',
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
      finalists: [],
    });

    expect(result.status).toBe("completed");
    expect(result.recommendation).toEqual({
      decision: "abstain",
      confidence: "low",
      summary: "The finalists are too weak to recommend safely.",
    });
  });

  it("accepts legacy winner output that omits an explicit decision", async () => {
    const root = await createTempRoot();
    const logDir = join(root, "judge-legacy-logs");

    const binaryPath = await writeNodeBinary(
      root,
      "fake-codex",
      `const fs = require("node:fs");
let out = "";
for (let index = 0; index < process.argv.length; index += 1) {
  if (process.argv[index] === "-o") {
    out = process.argv[index + 1] ?? "";
  }
}
if (out) {
  fs.writeFileSync(
    out,
    '{"candidateId":"cand-01","confidence":"high","summary":"missing the explicit decision field"}',
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
      finalists: [],
    });

    expect(result.status).toBe("completed");
    expect(result.recommendation).toEqual({
      decision: "select",
      candidateId: "cand-01",
      confidence: "high",
      summary: "missing the explicit decision field",
    });
  });

  it("asks Claude to recommend a winner with plan-mode json-schema output", async () => {
    const root = await createTempRoot();
    const logDir = join(root, "claude-winner-logs");

    const binaryPath = await writeNodeBinary(
      root,
      "fake-claude",
      `process.stderr.write(JSON.stringify({ argv: process.argv.slice(2) }));
process.stdout.write(JSON.stringify({
  candidateId: "cand-01",
  confidence: "medium",
  summary: "cand-01 is the safest finalist.",
}));`,
    );

    const adapter = new ClaudeAdapter({
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
          summary: "Fixes the bug cleanly.",
          artifactKinds: ["prompt"],
          verdicts: [],
          changedPaths: ["src/app.ts"],
          changeSummary: {
            mode: "git-diff",
            changedPathCount: 1,
            createdPathCount: 0,
            removedPathCount: 0,
            modifiedPathCount: 1,
            addedLineCount: 2,
            deletedLineCount: 1,
          },
          witnessRollup: {
            witnessCount: 0,
            warningOrHigherCount: 0,
            repairableCount: 0,
            repairHints: [],
            riskSummaries: [],
            keyWitnesses: [],
          },
          repairSummary: {
            attemptCount: 0,
            repairedRounds: [],
          },
        },
      ],
    });

    expect(result.status).toBe("completed");
    expect(result.recommendation).toEqual({
      decision: "select",
      candidateId: "cand-01",
      confidence: "medium",
      summary: "cand-01 is the safest finalist.",
    });
    await expect(readFile(join(logDir, "winner-judge.stderr.txt"), "utf8")).resolves.toContain(
      '"--permission-mode","plan"',
    );
    await expect(readFile(join(logDir, "winner-judge.stderr.txt"), "utf8")).resolves.toContain(
      '"--json-schema"',
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
    '{"profileId":"library","confidence":"high","summary":"Library signals are strongest.","candidateCount":12,"strategyIds":["minimal-change","test-amplified"],"selectedCommandIds":["lint-fast","typecheck-fast"],"missingCapabilities":[]}',
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
        workspaceRoots: [],
        workspaceMetadata: [],
        notes: [],
        capabilities: [],
        provenance: [],
        skippedCommandCandidates: [],
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
    expect(result.recommendation?.candidateCount).toBe(12);
    expect(result.recommendation?.selectedCommandIds).toEqual(["lint-fast", "typecheck-fast"]);
    await expect(readFile(join(logDir, "profile-judge.prompt.txt"), "utf8")).resolves.toContain(
      "Profile options:",
    );
    await expect(readFile(join(logDir, "profile-judge.stdout.jsonl"), "utf8")).resolves.toContain(
      '"--output-schema"',
    );
    await expect(readFile(join(logDir, "profile-judge.schema.json"), "utf8")).resolves.toContain(
      '"generic"',
    );
  });

  it("asks Claude to recommend a consultation profile with json-schema output", async () => {
    const root = await createTempRoot();
    const logDir = join(root, "profile-logs");

    const binaryPath = await writeNodeBinary(
      root,
      "fake-claude",
      `process.stderr.write(JSON.stringify({ argv: process.argv.slice(2) }));
process.stdout.write(JSON.stringify({
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
        workspaceRoots: [],
        workspaceMetadata: [],
        notes: [],
        capabilities: [],
        provenance: [],
        skippedCommandCandidates: [],
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
    await expect(readFile(join(logDir, "profile-judge.stderr.txt"), "utf8")).resolves.toContain(
      '"--permission-mode","plan"',
    );
    await expect(readFile(join(logDir, "profile-judge.stderr.txt"), "utf8")).resolves.toMatch(
      /generic/u,
    );
  }, 20_000);

  it("includes workspace command execution context in the profile selection prompt", () => {
    const prompt = buildProfileSelectionPrompt({
      runId: "run_1",
      projectRoot: "/repo",
      logDir: "/repo/.oraculum/logs",
      taskPacket: createTaskPacket(),
      signals: {
        packageManager: "pnpm",
        scripts: ["lint"],
        dependencies: ["typescript"],
        files: ["pnpm-workspace.yaml", "packages/app/package.json"],
        workspaceRoots: ["packages/*"],
        workspaceMetadata: [
          {
            label: "app",
            root: "packages/app",
            manifests: ["packages/app/package.json"],
          },
        ],
        notes: [],
        capabilities: [
          {
            kind: "command",
            value: "lint",
            source: "workspace-config",
            path: "packages/app/package.json",
            confidence: "high",
            detail: "Workspace package.json lint script is present.",
          },
        ],
        provenance: [],
        skippedCommandCandidates: [],
        commandCatalog: [
          {
            id: "lint-fast",
            roundId: "fast",
            label: "Lint",
            command: "pnpm",
            args: ["run", "lint"],
            relativeCwd: "packages/app",
            source: "repo-local-script",
            capability: "lint-fast",
            provenance: {
              signal: "script:lint",
              source: "workspace-config",
              path: "packages/app/package.json",
              detail: 'Workspace script "lint".',
            },
            invariant: "The app workspace should satisfy lint checks.",
          },
        ],
      },
      profileOptions: [
        { id: "generic", description: "Generic work." },
        { id: "library", description: "Library work." },
        { id: "frontend", description: "Frontend work." },
        { id: "migration", description: "Migration work." },
      ],
    });

    expect(prompt).toContain("Detected capabilities:");
    expect(prompt).not.toContain("Detected tags:");
    expect(prompt).toContain("Relative cwd: packages/app");
    expect(prompt).toContain(
      'Provenance: signal=script:lint source=workspace-config path=packages/app/package.json detail=Workspace script "lint".',
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
