import { describe, expect, it } from "vitest";

import { parseRunManifestArtifact } from "../src/services/run-manifest-artifact.js";
import {
  createRunCandidateArtifact,
  createRunManifestArtifact,
} from "./helpers/project-contracts.js";

describe("project contracts", () => {
  it("rejects planned manifests that persist a terminal outcome", () => {
    expect(() =>
      parseRunManifestArtifact(
        createRunManifestArtifact({
          status: "planned",
          candidateCount: 1,
          outcome: {
            type: "recommended-survivor",
            terminal: true,
            crownable: true,
            finalistCount: 1,
            recommendedCandidateId: "cand-01",
            validationPosture: "sufficient",
            verificationLevel: "standard",
            validationGapCount: 0,
            judgingBasisKind: "repo-local-oracle",
          },
        }),
      ),
    ).toThrow("planned manifests must use the pending-execution outcome type");
  });

  it("rejects completed manifests that still persist nonterminal outcome types", () => {
    expect(() =>
      parseRunManifestArtifact(
        createRunManifestArtifact({
          candidateCount: 1,
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
      ),
    ).toThrow("completed manifests cannot use pending-execution or running outcome types");
  });

  it("rejects manifests whose candidateCount does not match the persisted candidates", () => {
    expect(() =>
      parseRunManifestArtifact(
        createRunManifestArtifact({
          candidateCount: 2,
          candidates: [createRunCandidateArtifact("exported")],
          outcome: {
            type: "recommended-survivor",
            terminal: true,
            crownable: true,
            finalistCount: 1,
            recommendedCandidateId: "cand-01",
            validationPosture: "sufficient",
            verificationLevel: "standard",
            validationGapCount: 0,
            judgingBasisKind: "repo-local-oracle",
          },
        }),
      ),
    ).toThrow(
      "candidateCount must match the number of persisted candidates when candidate records are present",
    );
  });

  it("rejects manifests whose finalistCount does not match promoted or exported candidates", () => {
    expect(() =>
      parseRunManifestArtifact(
        createRunManifestArtifact({
          candidateCount: 1,
          candidates: [createRunCandidateArtifact("exported")],
          outcome: {
            type: "recommended-survivor",
            terminal: true,
            crownable: true,
            finalistCount: 0,
            recommendedCandidateId: "cand-01",
            validationPosture: "sufficient",
            verificationLevel: "standard",
            validationGapCount: 0,
            judgingBasisKind: "repo-local-oracle",
          },
        }),
      ),
    ).toThrow(
      "outcome.finalistCount must match the number of promoted or exported candidates when candidate records are present",
    );
  });

  it("rejects manifests that persist a recommended winner for non-survivor outcomes", () => {
    expect(() =>
      parseRunManifestArtifact(
        createRunManifestArtifact({
          candidateCount: 1,
          recommendedWinner: {
            candidateId: "cand-01",
            summary: "cand-01 is the recommended promotion.",
            confidence: "high",
            source: "llm-judge",
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
    ).toThrow("recommendedWinner is only allowed when outcome type is recommended-survivor");
  });
});
