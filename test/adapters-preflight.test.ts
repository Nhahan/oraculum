import { readFile } from "node:fs/promises";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { ClaudeAdapter } from "../src/adapters/claude.js";
import { CodexAdapter } from "../src/adapters/codex.js";
import {
  createRepoSignals,
  createTaskPacket,
  createTempRoot,
  registerAdaptersTempRootCleanup,
} from "./helpers/adapters.js";
import { writeNodeBinary } from "./helpers/fake-binary.js";

registerAdaptersTempRootCleanup();

describe("agent adapters preflight", () => {
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
});
