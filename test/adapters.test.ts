import { mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { ClaudeAdapter } from "../src/adapters/claude.js";
import { CodexAdapter } from "../src/adapters/codex.js";
import {
  buildCandidatePrompt,
  buildPreflightPrompt,
  buildProfileSelectionPrompt,
  buildWinnerSelectionPrompt,
} from "../src/adapters/prompt.js";
import {
  deriveResearchSignalFingerprint,
  materializedTaskPacketSchema,
} from "../src/domain/task.js";
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
    '{"decision":"select","candidateId":"cand-02","confidence":"medium","summary":"cand-02 preserved the strongest evidence.","judgingCriteria":["Leaves the target artifact internally consistent."]}',
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
    expect(result.recommendation?.judgingCriteria).toEqual([
      "Leaves the target artifact internally consistent.",
    ]);
    await expect(
      readFile(join(logDir, "winner-judge.final-message.txt"), "utf8"),
    ).resolves.toContain('"decision":"select"');
    await expect(readFile(join(logDir, "winner-judge.stdout.jsonl"), "utf8")).resolves.toContain(
      '"--output-schema"',
    );
    await expect(readFile(join(logDir, "winner-judge.stdout.jsonl"), "utf8")).resolves.toContain(
      '"read-only"',
    );
    await expect(readFile(join(logDir, "winner-judge.schema.json"), "utf8")).resolves.toContain(
      '"judgingCriteria"',
    );
    const winnerSchema = JSON.parse(
      await readFile(join(logDir, "winner-judge.schema.json"), "utf8"),
    ) as {
      type?: string;
      oneOf?: unknown;
      properties?: Record<string, { anyOf?: Array<{ type?: string }> }>;
      required?: string[];
    };
    expect(winnerSchema.type).toBe("object");
    expect(winnerSchema.oneOf).toBeUndefined();
    expect(winnerSchema.required).toEqual(
      expect.arrayContaining(["decision", "confidence", "summary", "judgingCriteria"]),
    );
    expect(winnerSchema.required).toEqual(expect.arrayContaining(["candidateId"]));
    expect(winnerSchema.properties?.candidateId?.anyOf).toEqual(
      expect.arrayContaining([expect.objectContaining({ type: "string" }), { type: "null" }]),
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
      taskPacket: createTaskPacket({
        artifactKind: "document",
        targetArtifactPath: "docs/PRD.md",
      }),
      consultationProfile: {
        validationProfileId: "frontend",
        confidence: "medium",
        validationSummary: "Frontend validation evidence is strongest.",
        validationSignals: ["frontend-config-evidence", "e2e-runner-evidence"],
        validationGaps: ["No build validation command was selected."],
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
      "Consultation validation posture: frontend (medium)",
    );
    await expect(readFile(join(logDir, "winner-judge.prompt.txt"), "utf8")).resolves.toContain(
      "Frontend validation evidence is strongest.",
    );
    await expect(readFile(join(logDir, "winner-judge.prompt.txt"), "utf8")).resolves.toContain(
      "Validation evidence:",
    );
    await expect(readFile(join(logDir, "winner-judge.prompt.txt"), "utf8")).resolves.toContain(
      "- frontend-config-evidence",
    );
    await expect(readFile(join(logDir, "winner-judge.prompt.txt"), "utf8")).resolves.toContain(
      "- e2e-runner-evidence",
    );
    await expect(readFile(join(logDir, "winner-judge.prompt.txt"), "utf8")).resolves.toContain(
      "Validation gaps from the selected posture:",
    );
    await expect(readFile(join(logDir, "winner-judge.prompt.txt"), "utf8")).resolves.toContain(
      "No build validation command was selected.",
    );
    await expect(readFile(join(logDir, "winner-judge.prompt.txt"), "utf8")).resolves.toContain(
      "Artifact-aware judging checklist:",
    );
    await expect(readFile(join(logDir, "winner-judge.prompt.txt"), "utf8")).resolves.toContain(
      '"judgingCriteria":["criterion"]',
    );
  });

  it("accepts null optional judging criteria from Codex structured output", async () => {
    const root = await createTempRoot();
    const logDir = join(root, "judge-null-criteria-logs");

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
    '{"decision":"abstain","confidence":"low","summary":"No finalist is clearly safest.","judgingCriteria":null}',
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
          changedPaths: ["README.md"],
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
          verdicts: [],
        },
      ],
    });

    expect(result.status).toBe("completed");
    expect(result.recommendation).toEqual({
      decision: "abstain",
      confidence: "low",
      summary: "No finalist is clearly safest.",
    });
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

  it("asks Codex to recommend a clarify follow-up with an output schema", async () => {
    const root = await createTempRoot();
    const logDir = join(root, "clarify-follow-up-codex-logs");

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
process.stdout.write(JSON.stringify({ event: "started", argv: process.argv.slice(2) }) + "\\n");
if (out) {
  fs.writeFileSync(
    out,
    '{"summary":"Repeated clarify blockers still leave the PRD contract underspecified.","keyQuestion":"Which sections and acceptance bullets must docs/PRD.md include?","missingResultContract":"A concrete section-level result contract for docs/PRD.md is still missing.","missingJudgingBasis":"The review basis does not yet define how to judge the completed PRD artifact."}',
    "utf8",
  );
}
`,
    );

    const adapter = new CodexAdapter({
      binaryPath,
      timeoutMs: 5_000,
    });

    const result = await adapter.recommendClarifyFollowUp({
      runId: "run_1",
      projectRoot: root,
      logDir,
      taskPacket: createTaskPacket({
        artifactKind: "document",
        targetArtifactPath: "docs/PRD.md",
      }),
      signals: createRepoSignals(),
      preflight: {
        decision: "needs-clarification",
        confidence: "medium",
        summary: "Need a clearer result contract before execution.",
        researchPosture: "repo-only",
        clarificationQuestion: "Which sections must docs/PRD.md contain?",
      },
      pressureContext: {
        scopeKeyType: "target-artifact",
        scopeKey: "docs/PRD.md",
        repeatedCaseCount: 3,
        repeatedKinds: ["clarify-needed", "external-research-required"],
        recurringReasons: [
          "Which sections must docs/PRD.md contain?",
          "What evidence is required before editing docs/PRD.md?",
        ],
        priorQuestions: ["Which sections must docs/PRD.md contain?"],
      },
    });

    expect(result.status).toBe("completed");
    expect(result.recommendation).toEqual({
      summary: "Repeated clarify blockers still leave the PRD contract underspecified.",
      keyQuestion: "Which sections and acceptance bullets must docs/PRD.md include?",
      missingResultContract:
        "A concrete section-level result contract for docs/PRD.md is still missing.",
      missingJudgingBasis:
        "The review basis does not yet define how to judge the completed PRD artifact.",
    });
    await expect(
      readFile(join(logDir, "clarify-follow-up.stdout.jsonl"), "utf8"),
    ).resolves.toContain('"--output-schema"');
    await expect(readFile(join(logDir, "clarify-follow-up.prompt.txt"), "utf8")).resolves.toContain(
      "You are deepening a repeated blocked Oraculum preflight on the same scope.",
    );
    await expect(readFile(join(logDir, "clarify-follow-up.prompt.txt"), "utf8")).resolves.toContain(
      "Prior repeated blocker questions:",
    );
    const schema = JSON.parse(
      await readFile(join(logDir, "clarify-follow-up.schema.json"), "utf8"),
    ) as {
      required?: string[];
    };
    expect(schema.required).toEqual(
      expect.arrayContaining([
        "summary",
        "keyQuestion",
        "missingResultContract",
        "missingJudgingBasis",
      ]),
    );
  });

  it("asks Claude to recommend a winner with plan-mode json-schema output", async () => {
    const root = await createTempRoot();
    const logDir = join(root, "claude-winner-logs");

    const binaryPath = await writeNodeBinary(
      root,
      "fake-claude",
      `const schemaIndex = process.argv.indexOf("--json-schema");
const schema = schemaIndex >= 0 ? process.argv[schemaIndex + 1] : "";
process.stderr.write(JSON.stringify({ argv: process.argv.slice(2), schema }));
process.stdout.write(JSON.stringify({
  type: "result",
  structured_output: {
    candidateId: "cand-01",
    confidence: "medium",
    summary: "cand-01 is the safest finalist.",
    judgingCriteria: ["Leaves the target artifact internally consistent."],
  },
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
      judgingCriteria: ["Leaves the target artifact internally consistent."],
    });
    await expect(readFile(join(logDir, "winner-judge.stderr.txt"), "utf8")).resolves.toContain(
      '"--permission-mode","plan"',
    );
    const stderr = await readFile(join(logDir, "winner-judge.stderr.txt"), "utf8");
    expect(stderr).toContain('"--json-schema"');
    const parsedStderr = JSON.parse(stderr) as { schema?: string };
    expect(parsedStderr.schema).toBeTruthy();
    const parsedSchema = JSON.parse(parsedStderr.schema ?? "{}") as {
      type?: string;
      properties?: Record<string, unknown>;
      required?: string[];
    };
    expect(parsedSchema.type).toBe("object");
    expect(parsedSchema.properties).toHaveProperty("judgingCriteria");
    expect(parsedSchema.properties).toHaveProperty("candidateId");
    expect(parsedSchema.required).toEqual(
      expect.arrayContaining(["decision", "confidence", "summary"]),
    );
  });

  it("asks Claude to recommend a clarify follow-up with json-schema output", async () => {
    const root = await createTempRoot();
    const logDir = join(root, "clarify-follow-up-claude-logs");

    const binaryPath = await writeNodeBinary(
      root,
      "fake-claude",
      `const schemaIndex = process.argv.indexOf("--json-schema");
const schema = schemaIndex >= 0 ? process.argv[schemaIndex + 1] : "";
process.stderr.write(JSON.stringify({ argv: process.argv.slice(2), schema }));
process.stdout.write(JSON.stringify({
  type: "result",
  structured_output: {
    summary: "Repeated clarify blockers still leave the PRD contract underspecified.",
    keyQuestion: "Which sections and acceptance bullets must docs/PRD.md include?",
    missingResultContract: "A concrete section-level result contract for docs/PRD.md is still missing.",
    missingJudgingBasis: "The review basis does not yet define how to judge the completed PRD artifact.",
  },
}));`,
    );

    const adapter = new ClaudeAdapter({
      binaryPath,
      timeoutMs: 5_000,
    });

    const result = await adapter.recommendClarifyFollowUp({
      runId: "run_1",
      projectRoot: root,
      logDir,
      taskPacket: createTaskPacket({
        artifactKind: "document",
        targetArtifactPath: "docs/PRD.md",
      }),
      signals: createRepoSignals(),
      preflight: {
        decision: "external-research-required",
        confidence: "high",
        summary: "Official docs are still required before execution.",
        researchPosture: "external-research-required",
        researchQuestion: "What should docs/PRD.md cover for this launch?",
      },
      pressureContext: {
        scopeKeyType: "target-artifact",
        scopeKey: "docs/PRD.md",
        repeatedCaseCount: 2,
        repeatedKinds: ["external-research-required"],
        recurringReasons: ["What should docs/PRD.md cover for this launch?"],
        priorQuestions: ["What should docs/PRD.md cover for this launch?"],
      },
    });

    expect(result.status).toBe("completed");
    expect(result.recommendation).toEqual({
      summary: "Repeated clarify blockers still leave the PRD contract underspecified.",
      keyQuestion: "Which sections and acceptance bullets must docs/PRD.md include?",
      missingResultContract:
        "A concrete section-level result contract for docs/PRD.md is still missing.",
      missingJudgingBasis:
        "The review basis does not yet define how to judge the completed PRD artifact.",
    });
    await expect(readFile(join(logDir, "clarify-follow-up.prompt.txt"), "utf8")).resolves.toContain(
      "Current blocked decision: external-research-required",
    );
    await expect(readFile(join(logDir, "clarify-follow-up.prompt.txt"), "utf8")).resolves.toContain(
      "Current confidence: high",
    );
    await expect(readFile(join(logDir, "clarify-follow-up.stderr.txt"), "utf8")).resolves.toContain(
      '"--json-schema"',
    );
    const stderr = await readFile(join(logDir, "clarify-follow-up.stderr.txt"), "utf8");
    const parsedStderr = JSON.parse(stderr) as { schema?: string };
    const parsedSchema = JSON.parse(parsedStderr.schema ?? "{}") as {
      required?: string[];
      properties?: Record<string, unknown>;
    };
    expect(parsedSchema.properties).toHaveProperty("keyQuestion");
    expect(parsedSchema.required).toEqual(
      expect.arrayContaining([
        "summary",
        "keyQuestion",
        "missingResultContract",
        "missingJudgingBasis",
      ]),
    );
  }, 20_000);

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
    '{"validationProfileId":"library","confidence":"high","validationSummary":"Library signals are strongest.","candidateCount":12,"strategyIds":["minimal-change","test-amplified"],"selectedCommandIds":["lint-fast","typecheck-fast"],"validationGaps":[]}',
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
      validationPostureOptions: [
        { id: "library", description: "Library work." },
        { id: "frontend", description: "Frontend work." },
        { id: "migration", description: "Migration work." },
      ],
    });

    expect(result.status).toBe("completed");
    expect(result.recommendation?.profileId).toBe("library");
    expect(result.recommendation?.validationProfileId).toBe("library");
    expect(result.recommendation?.summary).toBe("Library signals are strongest.");
    expect(result.recommendation?.validationSummary).toBe("Library signals are strongest.");
    expect(result.recommendation?.candidateCount).toBe(12);
    expect(result.recommendation?.selectedCommandIds).toEqual(["lint-fast", "typecheck-fast"]);
    await expect(readFile(join(logDir, "profile-judge.prompt.txt"), "utf8")).resolves.toContain(
      "Supported validation posture options:",
    );
    await expect(readFile(join(logDir, "profile-judge.prompt.txt"), "utf8")).resolves.toContain(
      "Treat validationProfileId as the canonical validation posture field for default tournament settings, not as a claim about the whole repository.",
    );
    await expect(readFile(join(logDir, "profile-judge.prompt.txt"), "utf8")).resolves.toContain(
      "Treat the supported validation posture options below as a compatibility layer for current default bundles, not as a complete repository taxonomy.",
    );
    await expect(readFile(join(logDir, "profile-judge.prompt.txt"), "utf8")).resolves.toContain(
      "Legacy aliases profileId, summary, and missingCapabilities are accepted for compatibility, but prefer validationProfileId, validationSummary, and validationGaps.",
    );
    await expect(readFile(join(logDir, "profile-judge.prompt.txt"), "utf8")).resolves.toContain(
      "Do not list theoretical profile-default checks when the repository provides no evidence for them.",
    );
    await expect(readFile(join(logDir, "profile-judge.stdout.jsonl"), "utf8")).resolves.toContain(
      '"--output-schema"',
    );
    const profileSchema = JSON.parse(
      await readFile(join(logDir, "profile-judge.schema.json"), "utf8"),
    ) as {
      required?: string[];
      properties?: Record<string, { type?: string; enum?: string[] }>;
    };
    expect(profileSchema.required).toEqual(
      expect.arrayContaining([
        "validationProfileId",
        "validationSummary",
        "validationGaps",
        "confidence",
        "candidateCount",
        "strategyIds",
        "selectedCommandIds",
      ]),
    );
    expect(profileSchema.properties).toHaveProperty("validationProfileId");
    expect(profileSchema.properties).toHaveProperty("profileId");
    expect(profileSchema.properties?.validationProfileId).toEqual(
      expect.objectContaining({ type: "string" }),
    );
    expect(profileSchema.properties?.profileId).toEqual(
      expect.objectContaining({
        anyOf: expect.arrayContaining([
          expect.objectContaining({ type: "string" }),
          expect.objectContaining({ type: "null" }),
        ]),
      }),
    );
    expect(profileSchema.properties?.validationProfileId).not.toHaveProperty("enum");
    expect(profileSchema.required).toEqual(
      expect.arrayContaining(["profileId", "summary", "missingCapabilities"]),
    );
  });

  it("accepts null optional profile aliases from Codex structured output", async () => {
    const root = await createTempRoot();
    const logDir = join(root, "profile-null-logs");

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
    '{"profileId":null,"validationProfileId":"generic","confidence":"low","summary":null,"validationSummary":"Use the generic posture.","candidateCount":3,"strategyIds":["minimal-change","safety-first"],"selectedCommandIds":[],"missingCapabilities":null,"validationGaps":[]}',
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
      signals: createRepoSignals(),
      validationPostureOptions: [
        { id: "generic", description: "Generic work." },
        { id: "frontend", description: "Frontend work." },
      ],
    });

    expect(result.status).toBe("completed");
    expect(result.recommendation).toEqual(
      expect.objectContaining({
        profileId: "generic",
        validationProfileId: "generic",
        summary: "Use the generic posture.",
        validationSummary: "Use the generic posture.",
      }),
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
  type: "result",
  structured_output: {
    validationProfileId: "frontend",
    confidence: "medium",
    validationSummary: "Frontend build and e2e signals are present.",
    candidateCount: 4,
    strategyIds: ["minimal-change", "safety-first"],
    selectedCommandIds: ["build-impact", "e2e-deep"],
    validationGaps: [],
  },
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
      validationPostureOptions: [
        { id: "library", description: "Library work." },
        { id: "frontend", description: "Frontend work." },
        { id: "migration", description: "Migration work." },
      ],
    });

    expect(result.status).toBe("completed");
    expect(result.recommendation?.profileId).toBe("frontend");
    expect(result.recommendation?.validationProfileId).toBe("frontend");
    expect(result.recommendation?.summary).toBe("Frontend build and e2e signals are present.");
    expect(result.recommendation?.validationSummary).toBe(
      "Frontend build and e2e signals are present.",
    );
    await expect(readFile(join(logDir, "profile-judge.prompt.txt"), "utf8")).resolves.toContain(
      "Command catalog:",
    );
    await expect(readFile(join(logDir, "profile-judge.prompt.txt"), "utf8")).resolves.toContain(
      'Use validationProfileId "generic" when the repository has no strong command-grounded or repo-local profile evidence.',
    );
    await expect(readFile(join(logDir, "profile-judge.stderr.txt"), "utf8")).resolves.toContain(
      '"--permission-mode","plan"',
    );
    await expect(readFile(join(logDir, "profile-judge.stderr.txt"), "utf8")).resolves.toMatch(
      /validationProfileId/u,
    );
  }, 20_000);

  it("ignores unrelated Claude nested objects that do not satisfy the full profile recommendation shape", async () => {
    const root = await createTempRoot();
    const logDir = join(root, "profile-nested-noise-logs");

    const binaryPath = await writeNodeBinary(
      root,
      "fake-claude",
      `process.stderr.write(JSON.stringify({ argv: process.argv.slice(2) }));
process.stdout.write(JSON.stringify({
  type: "result",
  metadata: {
    validationProfileId: "frontend",
    confidence: "medium",
    validationSummary: "noise only",
    candidateCount: 4
  },
  structured_output: {
    validationProfileId: "frontend",
    confidence: "medium",
    validationSummary: "Frontend build and e2e signals are present.",
    candidateCount: 4,
    strategyIds: ["minimal-change", "safety-first"],
    selectedCommandIds: ["build-impact", "e2e-deep"],
    validationGaps: []
  },
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
      validationPostureOptions: [
        { id: "frontend", description: "Frontend work." },
        { id: "generic", description: "Generic work." },
      ],
    });

    expect(result.status).toBe("completed");
    expect(result.recommendation?.validationProfileId).toBe("frontend");
    expect(result.recommendation?.validationSummary).toBe(
      "Frontend build and e2e signals are present.",
    );
    expect(result.recommendation?.selectedCommandIds).toEqual(["build-impact", "e2e-deep"]);
  }, 20_000);

  it("continues past invalid Claude nested profile objects and reads the next valid recommendation", async () => {
    const root = await createTempRoot();
    const logDir = join(root, "profile-nested-invalid-logs");

    const binaryPath = await writeNodeBinary(
      root,
      "fake-claude",
      `process.stderr.write(JSON.stringify({ argv: process.argv.slice(2) }));
process.stdout.write(JSON.stringify({
  type: "result",
  metadata: {
    profileId: "library",
    validationProfileId: "frontend",
    confidence: "medium",
    summary: "conflicting alias payload",
    validationSummary: "conflicting alias payload",
    candidateCount: 4,
    strategyIds: ["minimal-change"],
    selectedCommandIds: ["lint-fast"],
    validationGaps: []
  },
  structured_output: {
    validationProfileId: "frontend",
    confidence: "medium",
    validationSummary: "Frontend build and e2e signals are present.",
    candidateCount: 4,
    strategyIds: ["minimal-change", "safety-first"],
    selectedCommandIds: ["build-impact", "e2e-deep"],
    validationGaps: []
  },
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
      validationPostureOptions: [
        { id: "frontend", description: "Frontend work." },
        { id: "generic", description: "Generic work." },
      ],
    });

    expect(result.status).toBe("completed");
    expect(result.recommendation?.validationProfileId).toBe("frontend");
    expect(result.recommendation?.selectedCommandIds).toEqual(["build-impact", "e2e-deep"]);
  }, 20_000);

  it("rejects conflicting legacy and validation profile aliases", async () => {
    const root = await createTempRoot();
    const logDir = join(root, "profile-conflict-logs");

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
    '{"profileId":"library","validationProfileId":"frontend","confidence":"high","summary":"Library signals are strongest.","validationSummary":"Frontend signals are strongest.","candidateCount":4,"strategyIds":["minimal-change"],"selectedCommandIds":[],"missingCapabilities":[],"validationGaps":[]}',
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
        scripts: ["lint"],
        dependencies: [],
        files: ["package.json"],
        workspaceRoots: [],
        workspaceMetadata: [],
        notes: [],
        capabilities: [],
        provenance: [],
        skippedCommandCandidates: [],
        commandCatalog: [],
      },
      validationPostureOptions: [
        { id: "library", description: "Library work." },
        { id: "frontend", description: "Frontend work." },
      ],
    });

    expect(result.status).toBe("completed");
    expect(result.recommendation).toBeUndefined();
  });

  it("accepts matching validation gaps even when alias array order differs", async () => {
    const root = await createTempRoot();
    const logDir = join(root, "profile-alias-order-logs");

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
    '{"profileId":"frontend","validationProfileId":"frontend","confidence":"medium","summary":"Frontend build and e2e signals are present.","validationSummary":"Frontend build and e2e signals are present.","candidateCount":4,"strategyIds":["minimal-change"],"selectedCommandIds":[],"missingCapabilities":["No build validation command was selected.","No e2e or visual deep check was selected."],"validationGaps":["No e2e or visual deep check was selected.","No build validation command was selected."]}',
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
        scripts: ["build", "e2e"],
        dependencies: [],
        files: ["package.json"],
        workspaceRoots: [],
        workspaceMetadata: [],
        notes: [],
        capabilities: [],
        provenance: [],
        skippedCommandCandidates: [],
        commandCatalog: [],
      },
      validationPostureOptions: [
        { id: "frontend", description: "Frontend work." },
        { id: "generic", description: "Generic work." },
      ],
    });

    expect(result.status).toBe("completed");
    expect(result.recommendation?.profileId).toBe("frontend");
    expect(result.recommendation?.validationGaps).toEqual([
      "No e2e or visual deep check was selected.",
      "No build validation command was selected.",
    ]);
  });

  it("asks Codex for structured preflight readiness output", async () => {
    const root = await createTempRoot();
    const logDir = join(root, "preflight-logs");

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
process.stdout.write(JSON.stringify({ argv: process.argv.slice(2) }) + "\\n");
if (out) {
  fs.writeFileSync(
    out,
    '{"decision":"needs-clarification","confidence":"medium","summary":"The target document and required sections are unclear.","researchPosture":"repo-only","clarificationQuestion":"Which file should Oraculum update, and what sections are required?"}',
    "utf8",
  );
}
`,
    );

    const adapter = new CodexAdapter({
      binaryPath,
      timeoutMs: 5_000,
    });

    const result = await adapter.recommendPreflight({
      runId: "run_1",
      projectRoot: root,
      logDir,
      taskPacket: createTaskPacket(),
      signals: createRepoSignals(),
    });

    expect(result.status).toBe("completed");
    expect(result.recommendation).toEqual({
      decision: "needs-clarification",
      confidence: "medium",
      summary: "The target document and required sections are unclear.",
      researchPosture: "repo-only",
      clarificationQuestion: "Which file should Oraculum update, and what sections are required?",
    });
    await expect(readFile(join(logDir, "preflight-judge.prompt.txt"), "utf8")).resolves.toContain(
      "Only decide readiness.",
    );
    await expect(readFile(join(logDir, "preflight-judge.prompt.txt"), "utf8")).resolves.toContain(
      "Detected capabilities:",
    );
    await expect(readFile(join(logDir, "preflight-judge.prompt.txt"), "utf8")).resolves.toContain(
      "treat docs/ and internal/ as optional",
    );
    const preflightSchema = JSON.parse(
      await readFile(join(logDir, "preflight-judge.schema.json"), "utf8"),
    ) as {
      required?: string[];
    };
    expect(preflightSchema.required).toEqual(
      expect.arrayContaining([
        "decision",
        "confidence",
        "summary",
        "researchPosture",
        "clarificationQuestion",
        "researchQuestion",
      ]),
    );
  });

  it("accepts null optional preflight fields from Codex structured output", async () => {
    const root = await createTempRoot();
    const logDir = join(root, "preflight-null-logs");

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
    '{"decision":"needs-clarification","confidence":"high","summary":"The document contract is still unresolved.","researchPosture":"repo-only","clarificationQuestion":"Which audience and required sections should this document target?","researchQuestion":null}',
    "utf8",
  );
}
`,
    );

    const adapter = new CodexAdapter({
      binaryPath,
      timeoutMs: 5_000,
    });

    const result = await adapter.recommendPreflight({
      runId: "run_1",
      projectRoot: root,
      logDir,
      taskPacket: createTaskPacket(),
      signals: createRepoSignals(),
    });

    expect(result.status).toBe("completed");
    expect(result.recommendation).toEqual({
      decision: "needs-clarification",
      confidence: "high",
      summary: "The document contract is still unresolved.",
      researchPosture: "repo-only",
      clarificationQuestion: "Which audience and required sections should this document target?",
    });
  });

  it("asks Claude for structured preflight readiness output", async () => {
    const root = await createTempRoot();
    const logDir = join(root, "claude-preflight-logs");

    const binaryPath = await writeNodeBinary(
      root,
      "fake-claude",
      `process.stderr.write(JSON.stringify({ argv: process.argv.slice(2) }));
process.stdout.write(JSON.stringify({
  type: "result",
  structured_output: {
    decision: "external-research-required",
    confidence: "high",
    summary: "The request depends on external version-specific API behavior.",
    researchPosture: "external-research-required",
    researchQuestion: "What does the official API documentation say about the current versioned behavior?"
  }
}));`,
    );

    const adapter = new ClaudeAdapter({
      binaryPath,
      timeoutMs: 5_000,
    });

    const result = await adapter.recommendPreflight({
      runId: "run_1",
      projectRoot: root,
      logDir,
      taskPacket: createTaskPacket(),
      signals: createRepoSignals(),
    });

    expect(result.status).toBe("completed");
    expect(result.recommendation).toEqual({
      decision: "external-research-required",
      confidence: "high",
      summary: "The request depends on external version-specific API behavior.",
      researchPosture: "external-research-required",
      researchQuestion:
        "What does the official API documentation say about the current versioned behavior?",
    });
    await expect(readFile(join(logDir, "preflight-judge.stderr.txt"), "utf8")).resolves.toContain(
      '"--json-schema"',
    );
  });

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
      validationPostureOptions: [
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

  it("includes research brief provenance in shared prompts", () => {
    const taskPacket = createTaskPacket({
      intent: "Continue the original task using the required research context.",
      artifactKind: "document",
      targetArtifactPath: "docs/SESSION_PLAN.md",
      researchContext: {
        question: "What does the official API documentation say about the current behavior?",
        summary: "Review the official versioned API docs before execution.",
        confidence: "high",
        signalSummary: ["language:javascript"],
        signalFingerprint: deriveResearchSignalFingerprint(["language:javascript"]),
        sources: [
          {
            kind: "official-doc",
            title: "Current API docs",
            locator: "https://example.com/docs/current-api",
          },
        ],
        claims: [
          {
            statement: "The current API requires a version header on session refresh.",
            sourceLocators: ["https://example.com/docs/current-api"],
          },
        ],
        versionNotes: ["Behavior changed in v3.2 compared with the legacy session API."],
        unresolvedConflicts: ["The repo comments still describe the pre-v3.2 refresh flow."],
        conflictHandling: "manual-review-required",
      },
      source: {
        kind: "research-brief",
        path: "/repo/.oraculum/runs/run_1/reports/research-brief.json",
        originKind: "task-note",
        originPath: "/repo/tasks/fix-session-loss.md",
      },
    });

    const candidatePrompt = buildCandidatePrompt({
      runId: "run_1",
      candidateId: "cand-01",
      strategyId: "minimal-change",
      strategyLabel: "Minimal Change",
      workspaceDir: "/repo/.oraculum/workspaces/cand-01",
      logDir: "/repo/.oraculum/runs/run_1/candidates/cand-01/logs",
      taskPacket,
    });
    const winnerPrompt = buildWinnerSelectionPrompt({
      runId: "run_1",
      projectRoot: "/repo",
      logDir: "/repo/.oraculum/runs/run_1/reports",
      taskPacket,
      finalists: [],
    });
    const preflightPrompt = buildPreflightPrompt({
      runId: "run_1",
      projectRoot: "/repo",
      logDir: "/repo/.oraculum/runs/run_1/reports",
      taskPacket,
      signals: createRepoSignals(),
    });
    const profilePrompt = buildProfileSelectionPrompt({
      runId: "run_1",
      projectRoot: "/repo",
      logDir: "/repo/.oraculum/runs/run_1/reports",
      taskPacket,
      signals: createRepoSignals(),
      validationPostureOptions: [
        { id: "generic", description: "Generic work." },
        { id: "library", description: "Library work." },
        { id: "frontend", description: "Frontend work." },
        { id: "migration", description: "Migration work." },
      ],
    });

    for (const prompt of [candidatePrompt, winnerPrompt, preflightPrompt, profilePrompt]) {
      expect(prompt).toContain(
        "Task Source: research-brief (/repo/.oraculum/runs/run_1/reports/research-brief.json)",
      );
      expect(prompt).toContain(
        "Target result: recommended document result for docs/SESSION_PLAN.md",
      );
      expect(prompt).toContain("Artifact intent:");
      expect(prompt).toContain("- Kind: document");
      expect(prompt).toContain("- Target artifact: docs/SESSION_PLAN.md");
      expect(prompt).toContain("Task origin:");
      expect(prompt).toContain("- task-note (/repo/tasks/fix-session-loss.md)");
      expect(prompt).toContain("Accepted research context:");
      expect(prompt).toContain(
        "- Question: What does the official API documentation say about the current behavior?",
      );
      expect(prompt).toContain(
        "- Summary: Review the official versioned API docs before execution.",
      );
      expect(prompt).toContain("- Confidence: high");
      expect(prompt).toContain("- Conflict handling: manual-review-required");
      expect(prompt).toContain("Research signal basis:");
      expect(prompt).toContain("- language:javascript");
      expect(prompt).toContain(
        `- Signal fingerprint: ${deriveResearchSignalFingerprint(["language:javascript"])}`,
      );
      expect(prompt).toContain("Research sources:");
      expect(prompt).toContain(
        "- [official-doc] Current API docs — https://example.com/docs/current-api",
      );
      expect(prompt).toContain("Research claims:");
      expect(prompt).toContain(
        "- The current API requires a version header on session refresh. (sources: https://example.com/docs/current-api)",
      );
      expect(prompt).toContain("Version notes:");
      expect(prompt).toContain("- Behavior changed in v3.2 compared with the legacy session API.");
      expect(prompt).toContain("Unresolved conflicts:");
      expect(prompt).toContain("- The repo comments still describe the pre-v3.2 refresh flow.");
      expect(prompt).toContain("Research conflict rule:");
      expect(prompt).toContain(
        "- Treat unresolved conflicts as a reason to stay conservative, abstain, or require further clarification/research instead of guessing.",
      );
      expect(prompt).toContain("Research brief provenance:");
      expect(prompt).toContain(
        "Treat the research summary in the task intent as prior investigation context.",
      );
    }

    for (const prompt of [preflightPrompt, profilePrompt]) {
      expect(prompt).toContain("Research brief rules:");
      expect(prompt).toContain("Research basis comparison:");
      expect(prompt).toContain(
        `- Accepted signal fingerprint: ${deriveResearchSignalFingerprint(["language:javascript"])}`,
      );
      expect(prompt).toContain(
        `- Current signal fingerprint: ${deriveResearchSignalFingerprint(["command:lint"])}`,
      );
      expect(prompt).toContain("- Drift detected: yes");
      expect(prompt).toContain("Current repo signal basis:");
      expect(prompt).toContain("- command:lint");
      expect(prompt).toContain("Research staleness rule:");
      expect(prompt).toContain(
        "The repository signal basis has changed since this research was captured.",
      );
      expect(prompt).toContain(
        "Treat the research summary as prior external context, not as a repository fact.",
      );
      expect(prompt).toContain(
        "Do not ask for the same external research again unless the current repository state still leaves a concrete unresolved external dependency.",
      );
      expect(prompt).toContain(
        "Base command selection and validation on repository evidence and the command catalog, not on the research brief alone.",
      );
    }

    expect(candidatePrompt).toContain("You are generating one Oraculum candidate result.");
    expect(candidatePrompt).toContain(
      "- Materialize the required result by editing files in the workspace. Do not only describe the intended changes.",
    );
    expect(candidatePrompt).toContain(
      "- Candidates without a materialized result will be eliminated.",
    );
    expect(candidatePrompt).toContain("- Produce the strongest result you can for this strategy.");
    expect(candidatePrompt).toContain(
      "- Keep the final response concise and focused on the materialized result.",
    );
    expect(candidatePrompt).not.toContain(
      "Materialize the patch by editing files in the workspace.",
    );
    expect(winnerPrompt).toContain(
      "Either select the single safest finalist as the recommended result or abstain if no finalist is safe enough.",
    );
    expect(winnerPrompt).toContain(
      '"decision":"abstain","confidence":"low","summary":"why no finalist is safe to recommend"',
    );
    expect(preflightPrompt).toContain(
      "Do not solve the task and do not propose implementations. Only decide readiness.",
    );
  });
});

function createTaskPacket(
  overrides: Partial<ReturnType<typeof materializedTaskPacketSchema.parse>> = {},
) {
  return materializedTaskPacketSchema.parse({
    id: "fix-session-loss",
    title: "Fix session loss",
    intent: "Preserve login state during refresh.",
    nonGoals: [],
    acceptanceCriteria: [],
    risks: [],
    oracleHints: [],
    strategyHints: [],
    contextFiles: [],
    source: {
      kind: "task-note",
      path: "/tmp/task.md",
    },
    ...overrides,
  });
}

function createRepoSignals() {
  return {
    packageManager: "npm" as const,
    scripts: ["lint", "test"],
    dependencies: ["typescript"],
    files: ["package.json", "README.md"],
    workspaceRoots: [],
    workspaceMetadata: [],
    notes: ["Task input is repo-local."],
    capabilities: [
      {
        kind: "command" as const,
        value: "lint",
        source: "root-config" as const,
        confidence: "high" as const,
        detail: "Root lint script is present.",
      },
    ],
    provenance: [],
    skippedCommandCandidates: [],
    commandCatalog: [],
  };
}

async function createTempRoot(): Promise<string> {
  const path = await mkdtemp(join(tmpdir(), "oraculum-adapters-"));
  tempRoots.push(path);
  return path;
}
