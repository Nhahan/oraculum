import { describe, expect, it } from "vitest";

import { parseRunManifestArtifact } from "../src/services/run-manifest-artifact.js";
import {
  createRunCandidateArtifact,
  createRunManifestArtifact,
} from "./helpers/project-contracts.js";

describe("project contracts", () => {
  it("rejects manifests whose outcome gap count disagrees with persisted profile selection gaps", () => {
    expect(() =>
      parseRunManifestArtifact(
        createRunManifestArtifact({
          profileSelection: {
            validationProfileId: "frontend",
            confidence: "medium",
            source: "llm-recommendation",
            validationSummary: "Frontend evidence is strongest.",
            candidateCount: 1,
            strategyIds: ["minimal-change"],
            oracleIds: [],
            validationSignals: ["frontend-config"],
            validationGaps: ["No build validation command was selected."],
          },
          outcome: {
            type: "completed-with-validation-gaps",
            terminal: true,
            crownable: false,
            finalistCount: 0,
            validationPosture: "validation-gaps",
            verificationLevel: "none",
            validationGapCount: 0,
            judgingBasisKind: "missing-capability",
          },
        }),
      ),
    ).toThrow(
      "outcome.validationGapCount must match profileSelection validation gaps when a persisted profile selection is present",
    );
  });

  it("rejects manifests whose blocked preflight decision disagrees with the persisted outcome type", () => {
    expect(() =>
      parseRunManifestArtifact(
        createRunManifestArtifact({
          preflight: {
            decision: "needs-clarification",
            confidence: "medium",
            summary: "The target file is unclear.",
            researchPosture: "repo-only",
            clarificationQuestion: "Which file should Oraculum update?",
          },
          outcome: {
            type: "no-survivors",
            terminal: true,
            crownable: false,
            finalistCount: 0,
            validationPosture: "unknown",
            verificationLevel: "none",
            validationGapCount: 0,
            judgingBasisKind: "unknown",
          },
        }),
      ),
    ).toThrow(
      "blocked preflight decision needs-clarification requires outcome type needs-clarification",
    );

    expect(() =>
      parseRunManifestArtifact(
        createRunManifestArtifact({
          preflight: {
            decision: "proceed",
            confidence: "high",
            summary: "Repository evidence is sufficient to continue.",
            researchPosture: "repo-only",
          },
          outcome: {
            type: "external-research-required",
            terminal: true,
            crownable: false,
            finalistCount: 0,
            validationPosture: "validation-gaps",
            verificationLevel: "none",
            validationGapCount: 0,
            judgingBasisKind: "unknown",
          },
        }),
      ),
    ).toThrow("preflight decision proceed cannot persist a blocked preflight outcome type");
  });

  it("rejects blocked preflight manifests that still persist candidates or recommendations", () => {
    expect(() =>
      parseRunManifestArtifact(
        createRunManifestArtifact({
          candidateCount: 1,
          preflight: {
            decision: "needs-clarification",
            confidence: "medium",
            summary: "The target file is unclear.",
            researchPosture: "repo-only",
            clarificationQuestion: "Which file should Oraculum update?",
          },
          outcome: {
            type: "needs-clarification",
            terminal: true,
            crownable: false,
            finalistCount: 0,
            validationPosture: "unknown",
            verificationLevel: "none",
            validationGapCount: 0,
            judgingBasisKind: "unknown",
          },
        }),
      ),
    ).toThrow("blocked preflight manifests must not persist candidateCount above 0");

    expect(() =>
      parseRunManifestArtifact(
        createRunManifestArtifact({
          candidates: [createRunCandidateArtifact("planned")],
          preflight: {
            decision: "external-research-required",
            confidence: "high",
            summary: "Official docs are required before execution.",
            researchPosture: "external-research-required",
            researchQuestion:
              "What does the official API documentation say about the current behavior?",
          },
          outcome: {
            type: "external-research-required",
            terminal: true,
            crownable: false,
            finalistCount: 0,
            validationPosture: "validation-gaps",
            verificationLevel: "none",
            validationGapCount: 0,
            judgingBasisKind: "unknown",
          },
        }),
      ),
    ).toThrow("blocked preflight manifests must not persist candidate records");

    expect(() =>
      parseRunManifestArtifact(
        createRunManifestArtifact({
          preflight: {
            decision: "abstain",
            confidence: "medium",
            summary: "The repository setup is not executable yet.",
            researchPosture: "repo-only",
          },
          recommendedWinner: {
            candidateId: "cand-01",
            summary: "cand-01 is the recommended promotion.",
            confidence: "high",
            source: "llm-judge",
          },
          outcome: {
            type: "abstained-before-execution",
            terminal: true,
            crownable: false,
            finalistCount: 0,
            validationPosture: "unknown",
            verificationLevel: "none",
            validationGapCount: 0,
            judgingBasisKind: "unknown",
          },
        }),
      ),
    ).toThrow("blocked preflight manifests cannot persist a recommended winner");

    expect(() =>
      parseRunManifestArtifact(
        createRunManifestArtifact({
          rounds: [
            {
              id: "fast",
              label: "Fast",
              status: "completed",
              verdictCount: 0,
              survivorCount: 0,
              eliminatedCount: 0,
            },
          ],
          preflight: {
            decision: "needs-clarification",
            confidence: "medium",
            summary: "The target file is unclear.",
            researchPosture: "repo-only",
            clarificationQuestion: "Which file should Oraculum update?",
          },
          outcome: {
            type: "needs-clarification",
            terminal: true,
            crownable: false,
            finalistCount: 0,
            validationPosture: "unknown",
            verificationLevel: "none",
            validationGapCount: 0,
            judgingBasisKind: "unknown",
          },
        }),
      ),
    ).toThrow("blocked preflight manifests must not persist execution rounds");
  });
});
