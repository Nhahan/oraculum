import { readFile } from "node:fs/promises";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { ClaudeAdapter } from "../src/adapters/claude.js";
import { CodexAdapter } from "../src/adapters/codex.js";
import {
  createTaskPacket,
  createTempRoot,
  parseLoggedJson,
  registerAdaptersTempRootCleanup,
} from "./helpers/adapters.js";
import { writeNodeBinary } from "./helpers/fake-binary.js";

registerAdaptersTempRootCleanup();

describe("agent adapters winner selection", () => {
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
    const parsedStderr = parseLoggedJson(stderr) as { schema?: string };
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
});
