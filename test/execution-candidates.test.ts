import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { agentRunResultSchema } from "../src/adapters/types.js";
import {
  getAdvancedConfigPath,
  getCandidateAgentResultPath,
  getCandidateLogsDir,
  getCandidateOracleStderrLogPath,
  getCandidateOracleStdoutLogPath,
  getCandidateSpecPath,
  getCandidateSpecSelectionPath,
  getCandidateVerdictPath,
  getCandidateWitnessPath,
  getFinalistComparisonJsonPath,
  getFinalistComparisonMarkdownPath,
  getSecondOpinionWinnerSelectionPath,
} from "../src/core/paths.js";
import { oracleVerdictSchema, witnessSchema } from "../src/domain/oracle.js";
import type { ConsultProgressEvent } from "../src/services/consult-progress.js";
import { executeRun } from "../src/services/execution.js";
import { initializeProject } from "../src/services/project.js";
import { planRun, readRunManifest } from "../src/services/runs.js";
import {
  configureProjectOracles,
  createTempRoot,
  registerExecutionTempRootCleanup,
} from "./helpers/execution.js";
import { writeNodeBinary } from "./helpers/fake-binary.js";
import { EXECUTION_TEST_TIMEOUT_MS, FAKE_AGENT_TIMEOUT_MS } from "./helpers/integration.js";

registerExecutionTempRootCleanup();

describe("run execution candidates", () => {
  it(
    "executes candidates and persists agent run artifacts",
    async () => {
      const cwd = await createTempRoot();
      await initializeProject({ cwd, force: false });
      await writeFile(
        join(cwd, "tasks", "fix-session-loss.md"),
        "# Fix session loss\nKeep auth.\n",
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
process.stdout.write('{"event":"started"}\\n');
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

      const planned = await planRun({
        cwd,
        taskInput: "tasks/fix-session-loss.md",
        agent: "codex",
        candidates: 1,
      });

      const progress: ConsultProgressEvent[] = [];
      const executed = await executeRun({
        cwd,
        runId: planned.id,
        codexBinaryPath: fakeCodex,
        timeoutMs: FAKE_AGENT_TIMEOUT_MS,
        onProgress: (message) => {
          progress.push(message);
        },
      });

      expect(executed.candidateResults[0]?.status).toBe("completed");
      expect(executed.manifest.candidates[0]?.status).toBe("promoted");
      expect(executed.manifest.candidates[0]?.workspaceMode).toBe("copy");
      expect(executed.manifest.recommendedWinner?.candidateId).toBe("cand-01");
      expect(executed.manifest.recommendedWinner?.confidence).toBe("high");
      expect(executed.manifest.recommendedWinner?.source).toBe("llm-judge");
      expect(executed.manifest.outcome?.type).toBe("recommended-survivor");
      expect(executed.manifest.outcome?.verificationLevel).toBe("standard");
      expect(executed.manifest.updatedAt).toBeTruthy();
      expect(executed.manifest.updatedAt).not.toBe(executed.manifest.createdAt);

      const savedManifest = await readRunManifest(cwd, planned.id);
      expect(savedManifest.status).toBe("completed");
      expect(savedManifest.candidates[0]?.status).toBe("promoted");
      expect(savedManifest.recommendedWinner?.candidateId).toBe("cand-01");
      expect(savedManifest.outcome?.type).toBe("recommended-survivor");
      expect(savedManifest.updatedAt).toBe(executed.manifest.updatedAt);

      const resultPath = getCandidateAgentResultPath(cwd, planned.id, "cand-01");
      const parsedResult = agentRunResultSchema.parse(
        JSON.parse(await readFile(resultPath, "utf8")) as unknown,
      );
      expect(parsedResult.summary).toContain("Codex finished candidate patch");

      const verdictPath = getCandidateVerdictPath(cwd, planned.id, "cand-01", "fast", "agent-exit");
      const verdict = oracleVerdictSchema.parse(
        JSON.parse(await readFile(verdictPath, "utf8")) as unknown,
      );
      expect(verdict.status).toBe("pass");
      expect(verdict.roundId).toBe("fast");

      const witnessPath = getCandidateWitnessPath(
        cwd,
        planned.id,
        "cand-01",
        "fast",
        "cand-01-agent-exit",
      );
      const witness = witnessSchema.parse(
        JSON.parse(await readFile(witnessPath, "utf8")) as unknown,
      );
      expect(witness.detail).toContain("status=completed");
      expect(savedManifest.rounds.map((round) => round.status)).toEqual([
        "completed",
        "completed",
        "completed",
      ]);
      expect(savedManifest.rounds[0]?.verdictCount).toBeGreaterThan(0);
      expect(savedManifest.rounds[1]?.verdictCount).toBeGreaterThan(0);
      expect(savedManifest.rounds[2]?.verdictCount).toBe(0);

      const comparisonJson = JSON.parse(
        await readFile(getFinalistComparisonJsonPath(cwd, planned.id), "utf8"),
      ) as {
        recommendedWinner?: { candidateId: string };
        finalistCount: number;
        targetResultLabel: string;
      };
      expect(comparisonJson.finalistCount).toBe(1);
      expect(comparisonJson.recommendedWinner?.candidateId).toBe("cand-01");
      expect(comparisonJson.targetResultLabel).toBe("recommended survivor");
      await expect(
        readFile(getFinalistComparisonMarkdownPath(cwd, planned.id), "utf8"),
      ).resolves.toContain("Finalist Comparison");
      expect(progress.map((event) => event.message)).toEqual([
        "Launching 1 candidate",
        "Candidate 1/1 (cand-01) running",
        "Candidate 1/1 (cand-01) ready for checks",
        "Fast checks starting for 1 candidate",
        "Fast checks: Candidate 1/1 (cand-01) passed",
        "Fast checks complete: 1/1 candidate remains",
        "Impact checks starting for 1 candidate",
        "Impact checks: Candidate 1/1 (cand-01) passed",
        "Impact checks complete: 1/1 candidate remains",
        "Deep checks starting for 1 candidate",
        "Deep checks: Candidate 1/1 (cand-01) passed",
        "Deep checks complete: 1/1 candidate remains",
        "Comparing 1 surviving candidate",
        "Verdict ready",
      ]);
      expect(progress.map((event) => event.kind)).toEqual([
        "candidates-launching",
        "candidate-running",
        "candidate-ready-for-checks",
        "round-started",
        "candidate-passed-round",
        "round-completed",
        "round-started",
        "candidate-passed-round",
        "round-completed",
        "round-started",
        "candidate-passed-round",
        "round-completed",
        "comparing-finalists",
        "verdict-ready",
      ]);
    },
    EXECUTION_TEST_TIMEOUT_MS,
  );

  it(
    "compares specs first and only implements the selected spec by default",
    async () => {
      const cwd = await createTempRoot();
      await initializeProject({ cwd, force: false });
      await writeFile(
        join(cwd, "tasks", "spec-first.md"),
        "# Spec first\nPick the smallest implementation path.\n",
      );

      const fakeCodex = await writeNodeBinary(
        cwd,
        "fake-codex-spec-first",
        `const fs = require("node:fs");
const path = require("node:path");
const prompt = fs.readFileSync(0, "utf8");
const candidate = /Candidate ID: (cand-[0-9]+)/.exec(prompt)?.[1] ?? "cand-00";
let out = "";
for (let index = 0; index < process.argv.length; index += 1) {
  if (process.argv[index] === "-o") out = process.argv[index + 1] ?? "";
}
if (prompt.includes("You are proposing one Oraculum implementation spec.")) {
  fs.writeFileSync(out, JSON.stringify({
    summary: "Spec for " + candidate,
    approach: "Implement " + candidate + " with a direct file change.",
    keyChanges: ["Write the selected implementation marker."],
    expectedChangedPaths: ["src/" + candidate + ".txt"],
    acceptanceCriteria: ["The selected marker exists."],
    validationPlan: ["Use built-in materialized patch checks."],
    riskNotes: []
  }), "utf8");
} else if (prompt.includes("You are selecting Oraculum implementation specs")) {
  fs.writeFileSync(out, JSON.stringify({
    rankedCandidateIds: ["cand-02", "cand-03", "cand-01", "cand-04"],
    selectedCandidateIds: ["cand-02"],
    implementationVarianceRisk: "low",
    validationGaps: [],
    summary: "cand-02 is the narrowest safe spec.",
    reasons: [
      { candidateId: "cand-02", rank: 1, selected: true, reason: "Best direct path." },
      { candidateId: "cand-03", rank: 2, selected: false, reason: "Backup if implementation fails." },
      { candidateId: "cand-01", rank: 3, selected: false, reason: "Less focused." },
      { candidateId: "cand-04", rank: 4, selected: false, reason: "Too broad." }
    ]
  }), "utf8");
} else if (prompt.includes("You are selecting the best Oraculum finalist.")) {
  fs.writeFileSync(out, '{"decision":"select","candidateId":"cand-02","confidence":"high","summary":"cand-02 is the only surviving implementation."}', "utf8");
} else {
  fs.mkdirSync(path.join(process.cwd(), "src"), { recursive: true });
  fs.writeFileSync(path.join(process.cwd(), "src", candidate + ".txt"), "implemented " + candidate + "\\n", "utf8");
  fs.writeFileSync(out, "Implemented " + candidate, "utf8");
}
`,
      );

      const planned = await planRun({
        cwd,
        taskInput: "tasks/spec-first.md",
        agent: "codex",
        candidates: 4,
      });

      const executed = await executeRun({
        cwd,
        runId: planned.id,
        codexBinaryPath: fakeCodex,
        timeoutMs: FAKE_AGENT_TIMEOUT_MS,
      });

      expect(executed.candidateResults.map((result) => result.candidateId)).toEqual(["cand-02"]);
      expect(executed.manifest.searchStrategy).toBe("spec-first");
      expect(executed.manifest.recommendedWinner?.candidateId).toBe("cand-02");
      expect(
        executed.manifest.candidates
          .filter((candidate) => candidate.specPath)
          .map((candidate) => candidate.id),
      ).toEqual(["cand-01", "cand-02", "cand-03", "cand-04"]);
      expect(
        executed.manifest.candidates
          .filter((candidate) => candidate.lastRunResultPath)
          .map((candidate) => candidate.id),
      ).toEqual(["cand-02"]);
      expect(
        executed.manifest.candidates.find((candidate) => candidate.id === "cand-02")?.status,
      ).toBe("promoted");
      expect(
        executed.manifest.candidates.find((candidate) => candidate.id === "cand-03")?.status,
      ).toBe("eliminated");

      await expect(
        readFile(getCandidateSpecPath(cwd, planned.id, "cand-02"), "utf8"),
      ).resolves.toContain('"summary": "Spec for cand-02"');
      await expect(
        readFile(getCandidateSpecSelectionPath(cwd, planned.id), "utf8"),
      ).resolves.toContain('"selectedCandidateIds": [');
      await expect(
        readFile(join(getCandidateLogsDir(cwd, planned.id, "cand-02"), "prompt.txt"), "utf8"),
      ).resolves.toContain("Selected implementation spec:");

      const comparisonJson = JSON.parse(
        await readFile(getFinalistComparisonJsonPath(cwd, planned.id), "utf8"),
      ) as {
        searchStrategy?: string;
        specSearch?: {
          specCount: number;
          implementationCount: number;
          selectedSpecSummary?: string;
          rejectedSpecs: Array<{ candidateId: string }>;
        };
      };
      expect(comparisonJson.searchStrategy).toBe("spec-first");
      expect(comparisonJson.specSearch?.specCount).toBe(4);
      expect(comparisonJson.specSearch?.implementationCount).toBe(1);
      expect(comparisonJson.specSearch?.selectedSpecSummary).toBe("Spec for cand-02");
      expect(comparisonJson.specSearch?.rejectedSpecs.map((spec) => spec.candidateId)).toEqual([
        "cand-01",
        "cand-03",
        "cand-04",
      ]);
    },
    EXECUTION_TEST_TIMEOUT_MS,
  );

  it(
    "implements the backup ranked spec when the first selected spec is not crownable",
    async () => {
      const cwd = await createTempRoot();
      await initializeProject({ cwd, force: false });
      await writeFile(
        join(cwd, "tasks", "spec-backup.md"),
        "# Spec backup\nRecover when the first implementation misses the patch.\n",
      );

      const fakeCodex = await writeNodeBinary(
        cwd,
        "fake-codex-spec-backup",
        `const fs = require("node:fs");
const path = require("node:path");
const prompt = fs.readFileSync(0, "utf8");
const candidate = /Candidate ID: (cand-[0-9]+)/.exec(prompt)?.[1] ?? "cand-00";
let out = "";
for (let index = 0; index < process.argv.length; index += 1) {
  if (process.argv[index] === "-o") out = process.argv[index + 1] ?? "";
}
if (prompt.includes("You are proposing one Oraculum implementation spec.")) {
  fs.writeFileSync(out, JSON.stringify({
    summary: "Spec for " + candidate,
    approach: "Implementation path for " + candidate + ".",
    keyChanges: ["Change a file if this spec is implemented."],
    expectedChangedPaths: ["src/" + candidate + ".txt"],
    acceptanceCriteria: ["A materialized patch exists."],
    validationPlan: ["Use built-in materialized patch checks."],
    riskNotes: []
  }), "utf8");
} else if (prompt.includes("You are selecting Oraculum implementation specs")) {
  fs.writeFileSync(out, JSON.stringify({
    rankedCandidateIds: ["cand-01", "cand-02"],
    selectedCandidateIds: ["cand-01"],
    implementationVarianceRisk: "low",
    validationGaps: [],
    summary: "cand-01 is preferred, cand-02 is a backup.",
    reasons: [
      { candidateId: "cand-01", rank: 1, selected: true, reason: "Preferred spec." },
      { candidateId: "cand-02", rank: 2, selected: false, reason: "Backup spec." }
    ]
  }), "utf8");
} else if (prompt.includes("You are selecting the best Oraculum finalist.")) {
  fs.writeFileSync(out, '{"decision":"select","candidateId":"cand-02","confidence":"high","summary":"cand-02 recovered with a materialized patch."}', "utf8");
} else {
  if (candidate === "cand-02") {
    fs.mkdirSync(path.join(process.cwd(), "src"), { recursive: true });
    fs.writeFileSync(path.join(process.cwd(), "src", "backup.txt"), "backup patch\\n", "utf8");
  }
  fs.writeFileSync(out, "Candidate " + candidate + " finished", "utf8");
}
`,
      );

      const planned = await planRun({
        cwd,
        taskInput: "tasks/spec-backup.md",
        agent: "codex",
        candidates: 2,
      });

      const executed = await executeRun({
        cwd,
        runId: planned.id,
        codexBinaryPath: fakeCodex,
        timeoutMs: FAKE_AGENT_TIMEOUT_MS,
      });

      expect(executed.candidateResults.map((result) => result.candidateId)).toEqual([
        "cand-01",
        "cand-02",
      ]);
      expect(executed.manifest.recommendedWinner?.candidateId).toBe("cand-02");
      expect(
        executed.manifest.candidates.find((candidate) => candidate.id === "cand-01")?.status,
      ).toBe("eliminated");
      expect(
        executed.manifest.candidates.find((candidate) => candidate.id === "cand-02")?.status,
      ).toBe("promoted");
      expect(
        executed.manifest.candidates.find((candidate) => candidate.id === "cand-02")
          ?.specSelectionReason,
      ).toContain("Backup implementation triggered");
    },
    EXECUTION_TEST_TIMEOUT_MS,
  );

  it(
    "falls back to the patch tournament when spec selection fails",
    async () => {
      const cwd = await createTempRoot();
      await initializeProject({ cwd, force: false });
      await writeFile(
        join(cwd, "tasks", "spec-fallback.md"),
        "# Spec fallback\nUse patch tournament if selection fails.\n",
      );

      const fakeCodex = await writeNodeBinary(
        cwd,
        "fake-codex-spec-fallback",
        `const fs = require("node:fs");
const path = require("node:path");
const prompt = fs.readFileSync(0, "utf8");
const candidate = /Candidate ID: (cand-[0-9]+)/.exec(prompt)?.[1] ?? "cand-00";
let out = "";
for (let index = 0; index < process.argv.length; index += 1) {
  if (process.argv[index] === "-o") out = process.argv[index + 1] ?? "";
}
if (prompt.includes("You are proposing one Oraculum implementation spec.")) {
  fs.writeFileSync(out, JSON.stringify({
    summary: "Spec for " + candidate,
    approach: "Implementation path for " + candidate + ".",
    keyChanges: ["Write a fallback tournament patch."],
    expectedChangedPaths: ["src/" + candidate + ".txt"],
    acceptanceCriteria: ["A materialized patch exists."],
    validationPlan: ["Use built-in materialized patch checks."],
    riskNotes: []
  }), "utf8");
} else if (prompt.includes("You are selecting Oraculum implementation specs")) {
  fs.writeFileSync(out, "not structured json", "utf8");
} else if (prompt.includes("You are selecting the best Oraculum finalist.")) {
  fs.writeFileSync(out, '{"decision":"select","candidateId":"cand-01","confidence":"high","summary":"cand-01 wins after fallback."}', "utf8");
} else {
  fs.mkdirSync(path.join(process.cwd(), "src"), { recursive: true });
  fs.writeFileSync(path.join(process.cwd(), "src", candidate + ".txt"), "implemented " + candidate + "\\n", "utf8");
  fs.writeFileSync(out, "Implemented " + candidate, "utf8");
}
`,
      );

      const planned = await planRun({
        cwd,
        taskInput: "tasks/spec-fallback.md",
        agent: "codex",
        candidates: 2,
      });

      const executed = await executeRun({
        cwd,
        runId: planned.id,
        codexBinaryPath: fakeCodex,
        timeoutMs: FAKE_AGENT_TIMEOUT_MS,
      });

      expect(executed.manifest.searchStrategy).toBe("patch-tournament");
      expect(executed.candidateResults.map((result) => result.candidateId)).toEqual([
        "cand-01",
        "cand-02",
      ]);
      expect(executed.manifest.recommendedWinner?.candidateId).toBe("cand-01");
      expect(executed.manifest.candidates.every((candidate) => !candidate.specPath)).toBe(true);
      await expect(
        readFile(getCandidateSpecSelectionPath(cwd, planned.id), "utf8"),
      ).resolves.toContain("fallback-to-patch-tournament");
    },
    EXECUTION_TEST_TIMEOUT_MS,
  );

  it(
    "keeps the primary winner recommendation while persisting an advisory second opinion",
    async () => {
      const cwd = await createTempRoot();
      await initializeProject({ cwd, force: false });
      await writeFile(
        join(cwd, "tasks", "second-opinion.md"),
        "# Second opinion\nCheck the judge.\n",
      );
      await writeFile(
        getAdvancedConfigPath(cwd),
        `${JSON.stringify(
          {
            version: 1,
            judge: {
              secondOpinion: {
                enabled: true,
                adapter: "claude-code",
                triggers: ["many-changed-paths"],
                minChangedPaths: 1,
                minChangedLines: 200,
              },
            },
          },
          null,
          2,
        )}\n`,
        "utf8",
      );

      const fakeCodex = await writeNodeBinary(
        cwd,
        "fake-codex-second-opinion",
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
    ? '{"decision":"select","candidateId":"cand-01","confidence":"high","summary":"cand-01 remains the primary recommendation."}'
    : "Codex finished candidate patch";
  fs.writeFileSync(out, body, "utf8");
}
`,
      );
      const fakeClaude = await writeNodeBinary(
        cwd,
        "fake-claude-second-opinion",
        `const fs = require("node:fs");
const prompt = fs.readFileSync(0, "utf8");
if (prompt.includes("You are selecting the best Oraculum finalist.")) {
  process.stdout.write(JSON.stringify({
    decision: "abstain",
    confidence: "medium",
    summary: "A second opinion would wait for manual review before crowning."
  }));
} else {
  process.stdout.write(JSON.stringify({ summary: "unused" }));
}
`,
      );

      const planned = await planRun({
        cwd,
        taskInput: "tasks/second-opinion.md",
        agent: "codex",
        candidates: 1,
      });

      const progress: ConsultProgressEvent[] = [];
      const executed = await executeRun({
        cwd,
        runId: planned.id,
        codexBinaryPath: fakeCodex,
        claudeBinaryPath: fakeClaude,
        timeoutMs: FAKE_AGENT_TIMEOUT_MS,
        onProgress: (event) => {
          progress.push(event);
        },
      });

      expect(executed.manifest.recommendedWinner?.candidateId).toBe("cand-01");
      expect(executed.manifest.recommendedWinner?.source).toBe("llm-judge");
      expect(progress.map((event) => event.kind)).toContain("second-opinion-requested");
      expect(progress.map((event) => event.kind)).toContain("second-opinion-recorded");
      await expect(
        readFile(getSecondOpinionWinnerSelectionPath(cwd, planned.id), "utf8"),
      ).resolves.toContain('"agreement": "disagrees-select-vs-abstain"');
      await expect(
        readFile(getSecondOpinionWinnerSelectionPath(cwd, planned.id), "utf8"),
      ).resolves.toContain('"adapter": "claude-code"');
    },
    EXECUTION_TEST_TIMEOUT_MS,
  );

  it(
    "eliminates candidates when the adapter exits non-zero",
    async () => {
      const cwd = await createTempRoot();
      await initializeProject({ cwd, force: false });
      await writeFile(join(cwd, "tasks", "fail.md"), "# Fail\nReturn non-zero.\n");

      const fakeCodex = await writeNodeBinary(
        cwd,
        "fake-codex",
        `process.stdout.write('{"event":"started"}\\n');
process.exit(3);
`,
      );

      const planned = await planRun({
        cwd,
        taskInput: "tasks/fail.md",
        agent: "codex",
        candidates: 1,
      });

      const executed = await executeRun({
        cwd,
        runId: planned.id,
        codexBinaryPath: fakeCodex,
        timeoutMs: FAKE_AGENT_TIMEOUT_MS,
      });

      expect(executed.candidateResults[0]?.status).toBe("failed");
      expect(executed.manifest.candidates[0]?.status).toBe("eliminated");
      expect(executed.manifest.recommendedWinner).toBeUndefined();

      const verdictPath = getCandidateVerdictPath(cwd, planned.id, "cand-01", "fast", "agent-exit");
      const verdict = oracleVerdictSchema.parse(
        JSON.parse(await readFile(verdictPath, "utf8")) as unknown,
      );
      expect(verdict.status).toBe("fail");
    },
    EXECUTION_TEST_TIMEOUT_MS,
  );

  it("marks the candidate terminal and completes the run when the host binary cannot start", async () => {
    const cwd = await createTempRoot();
    await initializeProject({ cwd, force: false });
    await writeFile(join(cwd, "tasks", "missing-host.md"), "# Missing host\nFail to spawn.\n");

    const planned = await planRun({
      cwd,
      taskInput: "tasks/missing-host.md",
      agent: "codex",
      candidates: 1,
    });

    const executed = await executeRun({
      cwd,
      runId: planned.id,
      codexBinaryPath: join(cwd, "missing-codex"),
      timeoutMs: FAKE_AGENT_TIMEOUT_MS,
    });

    expect(executed.manifest.status).toBe("completed");
    expect(executed.candidateResults[0]?.status).toBe("failed");
    expect(executed.manifest.candidates[0]?.status).toBe("eliminated");

    const savedManifest = await readRunManifest(cwd, planned.id);
    expect(savedManifest.status).toBe("completed");
    expect(savedManifest.candidates[0]?.status).toBe("eliminated");

    const resultPath = getCandidateAgentResultPath(cwd, planned.id, "cand-01");
    const parsedResult = agentRunResultSchema.parse(
      JSON.parse(await readFile(resultPath, "utf8")) as unknown,
    );
    expect(parsedResult.summary).toContain("Failed to start subprocess");
    expect(savedManifest.rounds[0]?.status).toBe("completed");
    expect(savedManifest.rounds[0]?.eliminatedCount).toBe(1);
  });

  it("skips repo-local oracles when the candidate agent run already failed", async () => {
    const cwd = await createTempRoot();
    await initializeProject({ cwd, force: false });
    await writeFile(join(cwd, "tasks", "missing-host.md"), "# Missing host\nFail to spawn.\n");
    await configureProjectOracles(cwd, [
      {
        id: "workspace-sanity",
        roundId: "impact",
        command: process.execPath,
        args: ["-e", "process.exit(0);"],
        invariant: "Impact checks should only run for completed candidates.",
        enforcement: "hard",
      },
    ]);

    const planned = await planRun({
      cwd,
      taskInput: "tasks/missing-host.md",
      agent: "codex",
      candidates: 1,
    });

    await executeRun({
      cwd,
      runId: planned.id,
      codexBinaryPath: join(cwd, "missing-codex"),
      timeoutMs: FAKE_AGENT_TIMEOUT_MS,
    });

    await expect(
      readFile(
        getCandidateOracleStdoutLogPath(cwd, planned.id, "cand-01", "impact", "workspace-sanity"),
        "utf8",
      ),
    ).rejects.toThrow();
    await expect(
      readFile(
        getCandidateOracleStderrLogPath(cwd, planned.id, "cand-01", "impact", "workspace-sanity"),
        "utf8",
      ),
    ).rejects.toThrow();
  });

  it(
    "eliminates candidates that never materialize a patch in the workspace",
    async () => {
      const cwd = await createTempRoot();
      await initializeProject({ cwd, force: false });
      await writeFile(
        join(cwd, "tasks", "no-materialized-patch.md"),
        "# No patch\nExplain only.\n",
      );

      const fakeCodex = await writeNodeBinary(
        cwd,
        "fake-codex",
        `const fs = require("node:fs");
const prompt = fs.readFileSync(0, "utf8");
let out = "";
for (let index = 0; index < process.argv.length; index += 1) {
  if (process.argv[index] === "-o") {
    out = process.argv[index + 1] ?? "";
  }
}
if (out) {
  const body = prompt.includes("You are selecting the best Oraculum finalist.")
    ? '{"decision":"select","candidateId":"cand-01","confidence":"high","summary":"this should never be used"}'
    : "I would update src/greet.js, but I am only describing the patch.";
  fs.writeFileSync(out, body, "utf8");
}
`,
      );

      const planned = await planRun({
        cwd,
        taskInput: "tasks/no-materialized-patch.md",
        agent: "codex",
        candidates: 1,
      });

      const executed = await executeRun({
        cwd,
        runId: planned.id,
        codexBinaryPath: fakeCodex,
        timeoutMs: FAKE_AGENT_TIMEOUT_MS,
      });

      expect(executed.manifest.candidates[0]?.status).toBe("eliminated");
      expect(executed.manifest.recommendedWinner).toBeUndefined();

      const verdictPath = getCandidateVerdictPath(
        cwd,
        planned.id,
        "cand-01",
        "impact",
        "materialized-patch",
      );
      const verdict = oracleVerdictSchema.parse(
        JSON.parse(await readFile(verdictPath, "utf8")) as unknown,
      );
      expect(verdict.status).toBe("repairable");
      expect(verdict.summary).toContain("did not leave materialized file changes");
    },
    EXECUTION_TEST_TIMEOUT_MS,
  );

  it(
    "ignores unmanaged runtime state files when checking for a materialized patch",
    async () => {
      const cwd = await createTempRoot();
      await initializeProject({ cwd, force: false });
      await writeFile(
        join(cwd, "tasks", "unmanaged-only.md"),
        "# Unmanaged only\nWrite runtime state only.\n",
      );

      const fakeCodex = await writeNodeBinary(
        cwd,
        "fake-codex",
        `const fs = require("node:fs");
const path = require("node:path");
let out = "";
for (let index = 0; index < process.argv.length; index += 1) {
  if (process.argv[index] === "-o") {
    out = process.argv[index + 1] ?? "";
  }
}
fs.mkdirSync(path.join(process.cwd(), ".omc"), { recursive: true });
fs.writeFileSync(path.join(process.cwd(), ".omc", "project-memory.json"), '{"runtime":"state"}', "utf8");
if (out) {
  fs.writeFileSync(out, "runtime state only", "utf8");
}
`,
      );

      const planned = await planRun({
        cwd,
        taskInput: "tasks/unmanaged-only.md",
        agent: "codex",
        candidates: 1,
      });

      const executed = await executeRun({
        cwd,
        runId: planned.id,
        codexBinaryPath: fakeCodex,
        timeoutMs: FAKE_AGENT_TIMEOUT_MS,
      });

      expect(executed.manifest.candidates[0]?.status).toBe("eliminated");
      expect(executed.manifest.recommendedWinner).toBeUndefined();
    },
    EXECUTION_TEST_TIMEOUT_MS,
  );
});
