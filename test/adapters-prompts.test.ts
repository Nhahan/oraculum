import { describe, expect, it } from "vitest";

import {
  buildCandidatePrompt,
  buildCandidateSpecPrompt,
  buildPreflightPrompt,
  buildProfileSelectionPrompt,
  buildSpecSelectionPrompt,
  buildWinnerSelectionPrompt,
} from "../src/adapters/prompt.js";
import { candidateSpecArtifactSchema } from "../src/domain/run.js";
import { deriveResearchSignalFingerprint } from "../src/domain/task.js";
import { createRepoSignals, createTaskPacket } from "./helpers/adapters.js";
import { createConsultationPlanArtifactFixture } from "./helpers/contract-fixtures.js";

describe("adapter prompts", () => {
  it("includes plan-derived judging presets in winner-selection prompts", () => {
    const winnerPrompt = buildWinnerSelectionPrompt({
      runId: "run_plan_judging_prompt",
      projectRoot: "/repo",
      logDir: "/repo/.oraculum/runs/run_plan_judging_prompt/reports",
      taskPacket: createTaskPacket(),
      plannedJudgingPreset: {
        decisionDrivers: ["Target artifact path: docs/PRD.md"],
        plannedJudgingCriteria: [
          "Directly improves docs/PRD.md instead of only adjacent files.",
          "Leaves the planned document result internally consistent and reviewable.",
        ],
        crownGates: [
          "Do not recommend finalists that fail to materially change docs/PRD.md.",
          "Abstain if no finalist leaves the planned document result reviewable and internally consistent.",
        ],
      },
      finalists: [],
    });

    expect(winnerPrompt).toContain("Planned decision drivers:");
    expect(winnerPrompt).toContain("Target artifact path: docs/PRD.md");
    expect(winnerPrompt).toContain("Planned judging criteria:");
    expect(winnerPrompt).toContain(
      'Reuse these plan-derived criteria in JSON as "judgingCriteria"',
    );
    expect(winnerPrompt).toContain("Planned crown gates:");
    expect(winnerPrompt).toContain(
      "If no finalist clearly satisfies these gates, abstain instead of forcing a recommendation.",
    );
    expect(winnerPrompt).toContain(
      '"decision":"select","candidateId":"cand-01","confidence":"high","summary":"short rationale","judgingCriteria":["criterion"]}',
    );
    expect(winnerPrompt).toContain(
      "Respect the planned crown gates; abstain if no finalist clearly satisfies them.",
    );
  });

  it("includes finalist planned scorecards in winner-selection prompts", () => {
    const winnerPrompt = buildWinnerSelectionPrompt({
      runId: "run_plan_scorecards_prompt",
      projectRoot: "/repo",
      logDir: "/repo/.oraculum/runs/run_plan_scorecards_prompt/reports",
      taskPacket: createTaskPacket(),
      finalists: [
        {
          candidateId: "cand-01",
          strategyLabel: "Minimal Change",
          summary: "Candidate one summary.",
          artifactKinds: ["stdout"],
          verdicts: [],
          changedPaths: ["src/session.ts"],
          changeSummary: {
            mode: "git-diff",
            changedPathCount: 1,
            createdPathCount: 0,
            removedPathCount: 0,
            modifiedPathCount: 1,
            addedLineCount: 3,
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
          plannedScorecard: {
            mode: "complex",
            stageResults: [
              {
                stageId: "contract-fit",
                status: "pass",
                workstreamCoverage: {
                  "session-contract": "covered",
                },
                violations: [],
                unresolvedRisks: [],
              },
            ],
            violations: ["none"],
            unresolvedRisks: ["watch integration"],
            artifactCoherence: "strong",
            reversibility: "unknown",
          },
        },
      ],
    });

    expect(winnerPrompt).toContain("Planned scorecard rules:");
    expect(winnerPrompt).toContain("Planned scorecard:");
    expect(winnerPrompt).toContain("Mode: complex");
    expect(winnerPrompt).toContain("Stage results:");
    expect(winnerPrompt).toContain("contract-fit: pass");
    expect(winnerPrompt).toContain("Violations:");
    expect(winnerPrompt).toContain("Unresolved risks:");
  });

  it("builds spec-first prompts with plan contracts and selected spec context", () => {
    const taskPacket = createTaskPacket({
      acceptanceCriteria: ["Refresh keeps the active session."],
    });
    const consultationPlan = createConsultationPlanArtifactFixture(
      "/repo",
      "run_spec_prompt",
      "/repo/.oraculum/runs/run_spec_prompt/reports",
      {
        requiredChangedPaths: ["src/session.ts"],
        protectedPaths: ["src/legacy-auth.ts"],
        workstreams: [
          {
            id: "session-restore",
            label: "Session restore",
            goal: "Restore auth state before route guards run.",
            targetArtifacts: ["src/session.ts"],
            requiredChangedPaths: ["src/session.ts"],
            protectedPaths: ["src/legacy-auth.ts"],
            oracleIds: ["materialized-patch"],
            dependencies: [],
            risks: ["Refresh ordering is timing-sensitive."],
            disqualifiers: ["Do not rewrite legacy auth storage."],
          },
        ],
      },
    );
    const selectedSpec = candidateSpecArtifactSchema.parse({
      runId: "run_spec_prompt",
      candidateId: "cand-02",
      strategyId: "minimal-change",
      strategyLabel: "Minimal Change",
      adapter: "codex",
      createdAt: "2026-04-22T00:00:00.000Z",
      summary: "Restore session state before route checks.",
      approach: "Move refresh hydration before protected-route evaluation.",
      keyChanges: ["Update session restore ordering."],
      expectedChangedPaths: ["src/session.ts"],
      acceptanceCriteria: ["Refresh keeps the active session."],
      validationPlan: ["Run materialized patch checks."],
      riskNotes: ["Ordering changes can affect startup."],
    });

    const specPrompt = buildCandidateSpecPrompt({
      runId: "run_spec_prompt",
      candidateId: "cand-02",
      strategyId: "minimal-change",
      strategyLabel: "Minimal Change",
      projectRoot: "/repo",
      logDir: "/repo/.oraculum/runs/run_spec_prompt/candidates/cand-02/logs",
      taskPacket,
      consultationPlan,
    });
    const selectionPrompt = buildSpecSelectionPrompt({
      runId: "run_spec_prompt",
      projectRoot: "/repo",
      logDir: "/repo/.oraculum/runs/run_spec_prompt/reports",
      taskPacket,
      specs: [selectedSpec],
      consultationPlan,
    });
    const candidatePrompt = buildCandidatePrompt({
      runId: "run_spec_prompt",
      candidateId: "cand-02",
      strategyId: "minimal-change",
      strategyLabel: "Minimal Change",
      workspaceDir: "/repo/.oraculum/workspaces/run_spec_prompt/cand-02",
      logDir: "/repo/.oraculum/runs/run_spec_prompt/candidates/cand-02/logs",
      taskPacket,
      selectedSpec,
    });

    for (const prompt of [specPrompt, selectionPrompt]) {
      expect(prompt).toContain("Consultation plan contract:");
      expect(prompt).toContain("Required changed paths:");
      expect(prompt).toContain("src/session.ts");
      expect(prompt).toContain("Protected paths:");
      expect(prompt).toContain("src/legacy-auth.ts");
      expect(prompt).toContain("Workstreams:");
      expect(prompt).toContain("Session restore (session-restore)");
      expect(prompt).toContain("Do not rewrite legacy auth storage.");
    }
    expect(specPrompt).toContain("Do not edit files. Do not describe completed work.");
    expect(selectionPrompt).toContain("rankedCandidateIds must list every provided candidate id");
    expect(candidatePrompt).toContain("Selected implementation spec:");
    expect(candidatePrompt).toContain("Restore session state before route checks.");
    expect(candidatePrompt).toContain(
      "Treat this as the implementation contract for this candidate",
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
