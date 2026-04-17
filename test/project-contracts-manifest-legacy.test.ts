import { describe, expect, it } from "vitest";

import { parseRunManifestArtifact } from "../src/services/run-manifest-artifact.js";
import { createRunManifestArtifact } from "./helpers/project-contracts.js";

describe("project contracts", () => {
  it("derives outcome gaps from validation-first profile selections in legacy manifest normalization", () => {
    const parsed = parseRunManifestArtifact(
      createRunManifestArtifact({
        candidateCount: 1,
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
      }),
    );

    expect(parsed.outcome?.validationGapCount).toBe(1);
    expect(parsed.outcome?.validationPosture).toBe("validation-gaps");
  });

  it("backfills outcome gap aliases for legacy manifests that already persisted an outcome", () => {
    const parsed = parseRunManifestArtifact(
      createRunManifestArtifact({
        candidateCount: 1,
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
          judgingBasisKind: "missing-capability",
        },
      }),
    );

    expect(parsed.outcome?.validationGapCount).toBe(1);
    expect(parsed.outcome?.missingCapabilityCount).toBe(1);
    expect(parsed.outcome?.type).toBe("completed-with-validation-gaps");
  });

  it("backfills zero validation gaps for legacy blocked outcomes without persisted counts", () => {
    const parsed = parseRunManifestArtifact(
      createRunManifestArtifact({
        outcome: {
          type: "needs-clarification",
          terminal: true,
          crownable: false,
          finalistCount: 0,
          validationPosture: "unknown",
          verificationLevel: "none",
          judgingBasisKind: "unknown",
        },
      }),
    );

    expect(parsed.outcome?.validationGapCount).toBe(0);
    expect(parsed.outcome?.missingCapabilityCount).toBe(0);
    expect(parsed.outcome?.type).toBe("needs-clarification");
  });

  it("backfills zero validation gaps for legacy external-research outcomes without persisted counts", () => {
    const parsed = parseRunManifestArtifact(
      createRunManifestArtifact({
        outcome: {
          type: "external-research-required",
          terminal: true,
          crownable: false,
          finalistCount: 0,
          validationPosture: "validation-gaps",
          verificationLevel: "none",
          judgingBasisKind: "unknown",
        },
      }),
    );

    expect(parsed.outcome?.validationGapCount).toBe(0);
    expect(parsed.outcome?.missingCapabilityCount).toBe(0);
    expect(parsed.outcome?.type).toBe("external-research-required");
  });

  it("backfills the recommended candidate id for legacy survivor outcomes", () => {
    const parsed = parseRunManifestArtifact(
      createRunManifestArtifact({
        candidateCount: 1,
        recommendedWinner: {
          candidateId: "cand-01",
          summary: "cand-01 is the recommended promotion.",
          confidence: "high",
          source: "llm-judge",
        },
        outcome: {
          type: "recommended-survivor",
          terminal: true,
          crownable: true,
          finalistCount: 1,
          validationPosture: "sufficient",
          verificationLevel: "standard",
          validationGapCount: 0,
          judgingBasisKind: "repo-local-oracle",
        },
      }),
    );

    expect(parsed.outcome?.recommendedCandidateId).toBe("cand-01");
  });
});
