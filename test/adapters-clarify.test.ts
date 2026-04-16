import { readFile } from "node:fs/promises";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { ClaudeAdapter } from "../src/adapters/claude.js";
import { CodexAdapter } from "../src/adapters/codex.js";
import {
  createRepoSignals,
  createTaskPacket,
  createTempRoot,
  parseLoggedJson,
  registerAdaptersTempRootCleanup,
} from "./helpers/adapters.js";
import { writeNodeBinary } from "./helpers/fake-binary.js";

registerAdaptersTempRootCleanup();

describe("agent adapters clarify follow-up", () => {
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
    const parsedStderr = parseLoggedJson(stderr) as { schema?: string };
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
});
