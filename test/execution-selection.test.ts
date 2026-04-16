import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { describe, expect, it, vi } from "vitest";
import {
  getFailureAnalysisPath,
  getFinalistComparisonMarkdownPath,
  getLatestExportableRunStatePath,
  getLatestRunStatePath,
} from "../src/core/paths.js";
import type { CandidateManifest, CandidateScorecard } from "../src/domain/run.js";
import { executeRun, rankFallbackCandidates } from "../src/services/execution.js";
import * as finalistReportService from "../src/services/finalist-report.js";
import { initializeProject } from "../src/services/project.js";
import { planRun } from "../src/services/runs.js";
import {
  createTempRoot,
  registerExecutionTempRootCleanup,
  writeWorkspaceExportableNpmLibraryProfileProject,
} from "./helpers/execution.js";
import { writeNodeBinary } from "./helpers/fake-binary.js";

registerExecutionTempRootCleanup();

describe("run execution selection", () => {
  it("falls back to deterministic winner selection when the judge exits non-zero", async () => {
    const cwd = await createTempRoot();
    await initializeProject({ cwd, force: false });
    await writeFile(join(cwd, "tasks", "judge-failure.md"), "# Judge failure\nUse fallback.\n");

    const fakeCodex = await writeNodeBinary(
      cwd,
      "fake-codex",
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
  if (prompt.includes("You are selecting the best Oraculum finalist.")) {
    fs.writeFileSync(
      out,
      '{"decision":"select","candidateId":"cand-01","confidence":"high","summary":"this should be ignored"}',
      "utf8",
    );
    process.exit(7);
  }

  fs.writeFileSync(path.join(process.cwd(), "candidate-change.txt"), "patched\\n", "utf8");
  fs.writeFileSync(out, "Codex finished candidate patch", "utf8");
}
`,
    );

    const planned = await planRun({
      cwd,
      taskInput: "tasks/judge-failure.md",
      agent: "codex",
      candidates: 1,
    });

    const executed = await executeRun({
      cwd,
      runId: planned.id,
      codexBinaryPath: fakeCodex,
      timeoutMs: 5_000,
    });

    expect(executed.manifest.candidates[0]?.status).toBe("promoted");
    expect(executed.manifest.recommendedWinner?.candidateId).toBe("cand-01");
    expect(executed.manifest.recommendedWinner?.source).toBe("fallback-policy");
    await expect(
      readFile(getFinalistComparisonMarkdownPath(cwd, planned.id), "utf8"),
    ).resolves.toContain("fallback-policy");
  });

  it("mentions validation gaps in fallback winner summaries using the selected validation posture", async () => {
    const cwd = await createTempRoot();
    await initializeProject({ cwd, force: false });
    await writeFile(
      join(cwd, "tasks", "judge-failure-with-validation-gaps.md"),
      "# Judge failure\nUse fallback with validation gaps.\n",
    );
    await writeWorkspaceExportableNpmLibraryProfileProject(cwd);

    const fakeProfileCodex = await writeNodeBinary(
      cwd,
      "fake-codex-workspace-gap-profile",
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
    '{"profileId":"library","confidence":"high","summary":"Workspace package scripts and export metadata are present.","candidateCount":3,"strategyIds":["minimal-change","test-amplified"],"selectedCommandIds":["lint-fast","full-suite-deep"],"missingCapabilities":["No package packaging smoke check was detected."]}',
    "utf8",
  );
}
`,
    );

    const fakeCandidateCodex = await writeNodeBinary(
      cwd,
      "fake-codex-judge-failure-with-validation-gaps",
      `const fs = require("node:fs");
const path = require("node:path");
const prompt = fs.readFileSync(0, "utf8");
let out = "";
for (let index = 0; index < process.argv.length; index += 1) {
  if (process.argv[index] === "-o") {
    out = process.argv[index + 1] ?? "";
  }
}
if (!prompt.includes("You are selecting the best Oraculum finalist.")) {
  fs.writeFileSync(
    path.join(process.cwd(), "packages", "lib", "src", "index.js"),
    'export function greet() {\\n  return "Hello";\\n}\\n',
    "utf8",
  );
}
if (out) {
  if (prompt.includes("You are selecting the best Oraculum finalist.")) {
    fs.writeFileSync(
      out,
      '{"decision":"select","candidateId":"cand-01","confidence":"high","summary":"this should be ignored"}',
      "utf8",
    );
    process.exit(7);
  }

  fs.writeFileSync(out, "Codex finished candidate patch", "utf8");
}
`,
    );

    const planned = await planRun({
      cwd,
      taskInput: "tasks/judge-failure-with-validation-gaps.md",
      agent: "codex",
      candidates: 1,
      autoProfile: {
        codexBinaryPath: fakeProfileCodex,
        timeoutMs: 5_000,
      },
    });

    const executed = await executeRun({
      cwd,
      runId: planned.id,
      codexBinaryPath: fakeCandidateCodex,
      timeoutMs: 5_000,
    });

    expect(executed.manifest.recommendedWinner?.source).toBe("fallback-policy");
    expect(executed.manifest.recommendedWinner?.summary).toContain(
      "selected validation posture (library) still has validation gaps",
    );
    expect(executed.manifest.recommendedWinner?.summary).toContain(
      "No package packaging smoke check was selected.",
    );
  }, 20_000);

  it("prefers finalists with stronger planned scorecards in fallback ranking", () => {
    const finalists: CandidateManifest[] = [
      {
        id: "cand-01",
        strategyId: "minimal-change",
        strategyLabel: "Minimal Change",
        status: "promoted",
        workspaceDir: "/tmp/cand-01",
        taskPacketPath: "/tmp/task-packet.json",
        repairCount: 0,
        repairedRounds: [],
        createdAt: "2026-04-15T00:00:00.000Z",
      },
      {
        id: "cand-02",
        strategyId: "safety-first",
        strategyLabel: "Safety First",
        status: "promoted",
        workspaceDir: "/tmp/cand-02",
        taskPacketPath: "/tmp/task-packet.json",
        repairCount: 0,
        repairedRounds: [],
        createdAt: "2026-04-15T00:00:00.000Z",
      },
    ];

    const metricsByCandidate = new Map([
      [
        "cand-01",
        {
          candidateId: "cand-01",
          passCount: 2,
          repairableCount: 0,
          warningCount: 0,
          errorCount: 0,
          criticalCount: 0,
          artifactCount: 1,
        },
      ],
      [
        "cand-02",
        {
          candidateId: "cand-02",
          passCount: 2,
          repairableCount: 0,
          warningCount: 0,
          errorCount: 0,
          criticalCount: 0,
          artifactCount: 1,
        },
      ],
    ]);

    const betterScorecard: CandidateScorecard = {
      candidateId: "cand-01",
      mode: "complex",
      stageResults: [
        {
          stageId: "contract-fit",
          status: "pass",
          workstreamCoverage: {
            "session-contract": "covered",
            "api-compat": "covered",
          },
          violations: [],
          unresolvedRisks: [],
        },
      ],
      violations: [],
      unresolvedRisks: [],
      artifactCoherence: "strong",
      reversibility: "reversible",
    };
    const weakerScorecard: CandidateScorecard = {
      candidateId: "cand-02",
      mode: "complex",
      stageResults: [
        {
          stageId: "contract-fit",
          status: "repairable",
          workstreamCoverage: {
            "session-contract": "covered",
            "api-compat": "missing",
          },
          violations: ["missed api compat workstream"],
          unresolvedRisks: ["api compatibility not verified"],
        },
      ],
      violations: ["missed api compat workstream"],
      unresolvedRisks: ["api compatibility not verified"],
      artifactCoherence: "weak",
      reversibility: "unknown",
    };

    const scorecardsByCandidate = new Map<string, CandidateScorecard>([
      ["cand-01", betterScorecard],
      ["cand-02", weakerScorecard],
    ]);

    const ranked = rankFallbackCandidates(finalists, metricsByCandidate, scorecardsByCandidate);

    expect(ranked.map((candidate) => candidate.id)).toEqual(["cand-01", "cand-02"]);
  });

  it("keeps finalists but leaves no recommendation when the judge abstains", async () => {
    const cwd = await createTempRoot();
    await initializeProject({ cwd, force: false });
    await writeFile(
      join(cwd, "tasks", "judge-abstains.md"),
      "# Judge abstains\nDo not force a winner.\n",
    );

    const fakeCodex = await writeNodeBinary(
      cwd,
      "fake-codex",
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
  if (prompt.includes("You are selecting the best Oraculum finalist.")) {
    fs.writeFileSync(
      out,
      '{"decision":"abstain","confidence":"low","summary":"The finalists are too weak to recommend a safe promotion."}',
      "utf8",
    );
    process.exit(0);
  }

  fs.writeFileSync(path.join(process.cwd(), "candidate-change.txt"), "patched\\n", "utf8");
  fs.writeFileSync(out, "Codex finished candidate patch", "utf8");
}
`,
    );

    const planned = await planRun({
      cwd,
      taskInput: "tasks/judge-abstains.md",
      agent: "codex",
      candidates: 1,
    });

    const executed = await executeRun({
      cwd,
      runId: planned.id,
      codexBinaryPath: fakeCodex,
      timeoutMs: 5_000,
    });

    expect(executed.manifest.candidates[0]?.status).toBe("promoted");
    expect(executed.manifest.recommendedWinner).toBeUndefined();
    await expect(
      readFile(getFinalistComparisonMarkdownPath(cwd, planned.id), "utf8"),
    ).resolves.not.toContain("fallback-policy");
    const failureAnalysis = JSON.parse(
      await readFile(getFailureAnalysisPath(cwd, planned.id), "utf8"),
    ) as {
      trigger: string;
      summary: string;
      recommendedAction: string;
      candidates: Array<{ candidateId: string }>;
    };
    expect(failureAnalysis.trigger).toBe("judge-abstained");
    expect(failureAnalysis.summary).toContain("judge abstained");
    expect(failureAnalysis.recommendedAction).toBe("investigate-root-cause-before-rerun");
    expect(failureAnalysis.candidates[0]?.candidateId).toBe("cand-01");
  }, 20_000);

  it("does not advance latest consultation pointers when comparison reporting fails", async () => {
    const cwd = await createTempRoot();
    await initializeProject({ cwd, force: false });
    await writeFile(join(cwd, "tasks", "fix-session-loss.md"), "# Fix session loss\nKeep auth.\n");

    const fakeCodex = await writeNodeBinary(
      cwd,
      "fake-codex",
      `const fs = require("node:fs");
const path = require("node:path");
const prompt = fs.readFileSync(0, "utf8");
let out = "";
for (let index = 0; index < process.argv.length; index += 1) {
  if (process.argv[index] === "-o") {
    out = process.argv[index + 1] ?? "";
  }
}
if (!prompt.includes("You are selecting the best Oraculum finalist.")) {
  fs.writeFileSync(path.join(process.cwd(), "candidate-change.txt"), "patched\\n", "utf8");
}
if (out) {
  const body = prompt.includes("You are selecting the best Oraculum finalist.")
    ? '{"decision":"select","candidateId":"cand-01","confidence":"high","summary":"cand-01 is the only surviving finalist."}'
    : "Codex finished candidate patch";
  fs.writeFileSync(out, body, "utf8");
}
`,
    );

    const reportSpy = vi
      .spyOn(finalistReportService, "writeFinalistComparisonReport")
      .mockRejectedValueOnce(new Error("report write failed"));

    try {
      const planned = await planRun({
        cwd,
        taskInput: "tasks/fix-session-loss.md",
        agent: "codex",
        candidates: 1,
      });

      await expect(
        executeRun({
          cwd,
          runId: planned.id,
          codexBinaryPath: fakeCodex,
          timeoutMs: 5_000,
        }),
      ).rejects.toThrow("report write failed");

      await expect(readFile(getLatestRunStatePath(cwd), "utf8")).rejects.toThrow();
      await expect(readFile(getLatestExportableRunStatePath(cwd), "utf8")).rejects.toThrow();
    } finally {
      reportSpy.mockRestore();
    }
  }, 20_000);
});
