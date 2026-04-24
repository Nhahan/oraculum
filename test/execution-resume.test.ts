import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { agentRunResultSchema } from "../src/adapters/types.js";
import {
  getCandidateAgentResultPath,
  getCandidateManifestPath,
  getRunManifestPath,
} from "../src/core/paths.js";
import { candidateManifestSchema, runManifestSchema } from "../src/domain/run.js";
import { executeRun } from "../src/services/execution.js";
import { initializeProject } from "../src/services/project.js";
import { planRun, readRunManifest } from "../src/services/runs.js";
import { createTempRoot, registerExecutionTempRootCleanup } from "./helpers/execution.js";
import { writeNodeBinary } from "./helpers/fake-binary.js";
import { EXECUTION_TEST_TIMEOUT_MS, FAKE_AGENT_TIMEOUT_MS } from "./helpers/integration.js";

registerExecutionTempRootCleanup();

describe("run execution resume", () => {
  it(
    "resumes a running consultation from the persisted checkpoint without re-running completed candidates",
    async () => {
      const cwd = await createTempRoot();
      await initializeProject({ cwd, force: false });
      await writeFile(join(cwd, "tasks", "resume.md"), "# Resume\nContinue from checkpoint.\n");

      const executionCountPath = join(cwd, "candidate-run-count.txt");
      const fakeCodex = await writeNodeBinary(
        cwd,
        "fake-codex-resume",
        [
          'const fs = require("node:fs");',
          'const path = require("node:path");',
          'const prompt = fs.readFileSync(0, "utf8");',
          `const executionCountPath = ${JSON.stringify(executionCountPath)};`,
          'let out = "";',
          "for (let index = 0; index < process.argv.length; index += 1) {",
          '  if (process.argv[index] === "-o") out = process.argv[index + 1] ?? "";',
          "}",
          'const isWinner = prompt.includes("You are selecting the best Oraculum finalist.");',
          "if (!isWinner) {",
          '  const current = fs.existsSync(executionCountPath) ? Number.parseInt(fs.readFileSync(executionCountPath, "utf8"), 10) : 0;',
          '  fs.writeFileSync(executionCountPath, String(current + 1), "utf8");',
          "}",
          "if (out) {",
          "  const body = isWinner",
          '    ? \'{"decision":"select","candidateId":"cand-01","confidence":"high","summary":"cand-01 remains the recommended finalist."}\'',
          '    : "Codex resumed candidate patch";',
          '  fs.writeFileSync(out, body, "utf8");',
          "}",
        ].join("\n"),
      );

      const planned = await planRun({
        cwd,
        taskInput: "tasks/resume.md",
        agent: "codex",
        candidates: 1,
      });

      const candidate = planned.candidates[0];
      if (!candidate) {
        throw new Error("Expected a planned candidate.");
      }

      const candidateResultPath = getCandidateAgentResultPath(cwd, planned.id, candidate.id);
      await writeFile(
        candidateResultPath,
        `${JSON.stringify(
          agentRunResultSchema.parse({
            runId: planned.id,
            candidateId: candidate.id,
            adapter: "codex",
            status: "completed",
            startedAt: "2026-04-04T00:00:00.000Z",
            completedAt: "2026-04-04T00:01:00.000Z",
            exitCode: 0,
            summary: "Persisted candidate execution.",
            artifacts: [],
          }),
          null,
          2,
        )}\n`,
        "utf8",
      );

      const resumedCandidate = candidateManifestSchema.parse({
        ...candidate,
        status: "judged",
        workspaceMode: "copy",
        lastRunResultPath: candidateResultPath,
      });
      await writeFile(
        getCandidateManifestPath(cwd, planned.id, candidate.id),
        `${JSON.stringify(resumedCandidate, null, 2)}\n`,
        "utf8",
      );

      await writeFile(
        getRunManifestPath(cwd, planned.id),
        `${JSON.stringify(
          runManifestSchema.parse({
            ...planned,
            status: "running",
            rounds: planned.rounds.map((round, index) =>
              index < 2
                ? {
                    ...round,
                    status: "completed",
                    startedAt: "2026-04-04T00:00:00.000Z",
                    completedAt: "2026-04-04T00:01:00.000Z",
                  }
                : round,
            ),
            candidates: [resumedCandidate],
            outcome: {
              type: "running",
              terminal: false,
              crownable: false,
              finalistCount: 0,
              validationPosture: "unknown",
              verificationLevel: "none",
              validationGapCount: 0,
              judgingBasisKind: "unknown",
            },
          }),
          null,
          2,
        )}\n`,
        "utf8",
      );

      const executed = await executeRun({
        cwd,
        runId: planned.id,
        codexBinaryPath: fakeCodex,
        timeoutMs: FAKE_AGENT_TIMEOUT_MS,
      });

      const candidateRunCount = Number.parseInt(
        await readFile(executionCountPath, "utf8").catch(() => "0"),
        10,
      );
      expect(candidateRunCount).toBe(0);
      expect(executed.manifest.id).toBe(planned.id);
      expect(executed.manifest.status).toBe("completed");
      expect(executed.manifest.recommendedWinner?.candidateId).toBe(candidate.id);

      const savedManifest = await readRunManifest(cwd, planned.id);
      expect(savedManifest.status).toBe("completed");
      expect(savedManifest.recommendedWinner?.candidateId).toBe(candidate.id);
    },
    EXECUTION_TEST_TIMEOUT_MS,
  );
});
