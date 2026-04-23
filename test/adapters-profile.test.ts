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
import { EXECUTION_TEST_TIMEOUT_MS, FAKE_AGENT_TIMEOUT_MS } from "./helpers/integration.js";

registerAdaptersTempRootCleanup();

describe("agent adapters profile selection", () => {
  it("asks Codex to recommend a consultation profile with a canonical output schema", async () => {
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
      timeoutMs: FAKE_AGENT_TIMEOUT_MS,
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
    expect(result.recommendation?.validationProfileId).toBe("library");
    expect(result.recommendation?.validationSummary).toBe("Library signals are strongest.");
    expect(result.recommendation?.candidateCount).toBe(12);
    expect(result.recommendation?.selectedCommandIds).toEqual(["lint-fast", "typecheck-fast"]);
    await expect(readFile(join(logDir, "profile-judge.prompt.txt"), "utf8")).resolves.toContain(
      "Supported validation posture options:",
    );
    await expect(readFile(join(logDir, "profile-judge.prompt.txt"), "utf8")).resolves.toContain(
      'Use validationProfileId "generic" when the repository has no strong command-grounded or repo-local profile evidence.',
    );
    await expect(readFile(join(logDir, "profile-judge.prompt.txt"), "utf8")).resolves.not.toContain(
      "Detected dependencies:",
    );
    await expect(readFile(join(logDir, "profile-judge.prompt.txt"), "utf8")).resolves.toContain(
      "witness-producing or falsification-producing checks",
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
    expect(profileSchema.properties).not.toHaveProperty("profileId");
    expect(profileSchema.properties?.validationProfileId).toEqual(
      expect.objectContaining({ type: "string" }),
    );
    expect(profileSchema.properties?.validationProfileId).not.toHaveProperty("enum");
  });

  it("parses canonical Codex structured profile output", async () => {
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
    '{"validationProfileId":"generic","confidence":"low","validationSummary":"Use the generic posture.","candidateCount":3,"strategyIds":["minimal-change","safety-first"],"selectedCommandIds":[],"validationGaps":[]}',
    "utf8",
  );
}
`,
    );

    const adapter = new CodexAdapter({
      binaryPath,
      timeoutMs: FAKE_AGENT_TIMEOUT_MS,
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
        validationProfileId: "generic",
        validationSummary: "Use the generic posture.",
      }),
    );
  });

  it(
    "asks Claude to recommend a consultation profile with json-schema output",
    async () => {
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
        timeoutMs: FAKE_AGENT_TIMEOUT_MS,
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
      expect(result.recommendation?.validationProfileId).toBe("frontend");
      expect(result.recommendation?.validationSummary).toBe(
        "Frontend build and e2e signals are present.",
      );
      await expect(readFile(join(logDir, "profile-judge.prompt.txt"), "utf8")).resolves.toContain(
        "Command catalog:",
      );
      await expect(readFile(join(logDir, "profile-judge.stderr.txt"), "utf8")).resolves.toContain(
        '"--permission-mode","plan"',
      );
      await expect(readFile(join(logDir, "profile-judge.stderr.txt"), "utf8")).resolves.toMatch(
        /validationProfileId/u,
      );
    },
    EXECUTION_TEST_TIMEOUT_MS,
  );

  it(
    "ignores unrelated Claude nested objects that do not satisfy the full profile recommendation shape",
    async () => {
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
        timeoutMs: FAKE_AGENT_TIMEOUT_MS,
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
    },
    EXECUTION_TEST_TIMEOUT_MS,
  );

  it(
    "continues past invalid Claude nested profile objects and reads the next valid recommendation",
    async () => {
      const root = await createTempRoot();
      const logDir = join(root, "profile-nested-invalid-logs");

      const binaryPath = await writeNodeBinary(
        root,
        "fake-claude",
        `process.stderr.write(JSON.stringify({ argv: process.argv.slice(2) }));
process.stdout.write(JSON.stringify({
  type: "result",
  metadata: {
    validationProfileId: "frontend",
    confidence: "medium",
    validationSummary: "incomplete metadata payload",
    candidateCount: 4,
    strategyIds: ["minimal-change"]
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
        timeoutMs: FAKE_AGENT_TIMEOUT_MS,
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
    },
    EXECUTION_TEST_TIMEOUT_MS,
  );

  it("rejects Codex profile output that omits canonical validation fields", async () => {
    const root = await createTempRoot();
    const logDir = join(root, "profile-invalid-logs");

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
    '{"confidence":"high","validationSummary":"Frontend signals are strongest.","candidateCount":4,"strategyIds":["minimal-change"],"selectedCommandIds":[],"validationGaps":[]}',
    "utf8",
  );
}
`,
    );

    const adapter = new CodexAdapter({
      binaryPath,
      timeoutMs: FAKE_AGENT_TIMEOUT_MS,
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

  it("preserves canonical validation gap ordering", async () => {
    const root = await createTempRoot();
    const logDir = join(root, "profile-gap-order-logs");

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
    '{"validationProfileId":"frontend","confidence":"medium","validationSummary":"Frontend build and e2e signals are present.","candidateCount":4,"strategyIds":["minimal-change"],"selectedCommandIds":[],"validationGaps":["No e2e or visual deep check was selected.","No build validation command was selected."]}',
    "utf8",
  );
}
`,
    );

    const adapter = new CodexAdapter({
      binaryPath,
      timeoutMs: FAKE_AGENT_TIMEOUT_MS,
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
    expect(result.recommendation?.validationProfileId).toBe("frontend");
    expect(result.recommendation?.validationGaps).toEqual([
      "No e2e or visual deep check was selected.",
      "No build validation command was selected.",
    ]);
  });
});
