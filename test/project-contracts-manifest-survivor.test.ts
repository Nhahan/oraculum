import { describe, expect, it } from "vitest";

import { parseRunManifestArtifact } from "../src/services/run-manifest-artifact.js";
import {
  createRunCandidateArtifact,
  createRunManifestArtifact,
} from "./helpers/project-contracts.js";

describe("project contracts", () => {
  it("rejects manifests whose recommended winner disagrees with the outcome survivor id", () => {
    expect(() =>
      parseRunManifestArtifact(
        createRunManifestArtifact({
          candidateCount: 1,
          recommendedWinner: {
            candidateId: "cand-02",
            summary: "cand-02 is the recommended promotion.",
            confidence: "high",
            source: "llm-judge",
          },
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
      "recommendedWinner.candidateId must match outcome.recommendedCandidateId when both are present.",
    );
  });

  it("rejects manifests whose recommended survivor is not promoted or exported", () => {
    expect(() =>
      parseRunManifestArtifact(
        createRunManifestArtifact({
          candidateCount: 1,
          candidates: [createRunCandidateArtifact("planned")],
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
      "recommended survivors must reference a promoted or exported candidate when that candidate is present in the manifest",
    );
  });

  it("rejects manifests whose recommended survivor does not exist in persisted candidate records", () => {
    expect(() =>
      parseRunManifestArtifact(
        createRunManifestArtifact({
          candidateCount: 1,
          candidates: [createRunCandidateArtifact("exported", { id: "cand-02" })],
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
      "recommended survivors must reference a persisted candidate when candidate records are present in the manifest",
    );
  });
});
