import { getValidationGaps } from "../profile.js";

import type {
  CandidateManifest,
  ConsultationOutcome,
  ConsultationPreflight,
  RunManifest,
  RunRound,
} from "./schema.js";

interface ConsultationOutcomeInput {
  candidates: Array<Pick<CandidateManifest, "status">>;
  rounds?: Array<Pick<RunRound, "id" | "status" | "verdictCount">>;
  profileSelection?: {
    validationGaps?: string[] | undefined;
    missingCapabilities?: string[] | undefined;
    oracleIds: string[];
  };
  recommendedWinner?: Pick<NonNullable<RunManifest["recommendedWinner"]>, "candidateId">;
  status: RunManifest["status"];
}

interface ConsultationOutcomeManifestInput {
  status: RunManifest["status"];
  candidates: Array<Pick<CandidateManifest, "status">>;
  rounds?: Array<Pick<RunRound, "id" | "status" | "verdictCount">> | undefined;
  profileSelection?:
    | {
        validationGaps?: string[] | undefined;
        missingCapabilities?: string[] | undefined;
        oracleIds: string[];
      }
    | undefined;
  recommendedWinner?:
    | Pick<NonNullable<RunManifest["recommendedWinner"]>, "candidateId">
    | undefined;
}

export function deriveConsultationOutcome(input: ConsultationOutcomeInput): ConsultationOutcome {
  const finalistCount = input.candidates.filter(
    (candidate) => candidate.status === "promoted" || candidate.status === "exported",
  ).length;
  const validationGapCount = getValidationGaps(input.profileSelection).length;
  const verificationLevel = deriveVerificationLevel(input.rounds, validationGapCount);
  const judgingBasisKind =
    (input.profileSelection?.oracleIds.length ?? 0) > 0
      ? "repo-local-oracle"
      : validationGapCount > 0
        ? "missing-capability"
        : "unknown";
  const validationPosture =
    validationGapCount > 0 ? "validation-gaps" : input.profileSelection ? "sufficient" : "unknown";

  if (input.status === "planned") {
    return {
      type: "pending-execution",
      terminal: false,
      crownable: false,
      finalistCount,
      validationPosture,
      verificationLevel,
      validationGapCount,
      judgingBasisKind,
    };
  }

  if (input.status === "running") {
    return {
      type: "running",
      terminal: false,
      crownable: false,
      finalistCount,
      validationPosture,
      verificationLevel,
      validationGapCount,
      judgingBasisKind,
    };
  }

  if (input.recommendedWinner) {
    return {
      type: "recommended-survivor",
      terminal: true,
      crownable: true,
      finalistCount,
      recommendedCandidateId: input.recommendedWinner.candidateId,
      validationPosture,
      verificationLevel,
      validationGapCount,
      judgingBasisKind,
    };
  }

  if (finalistCount > 0) {
    return {
      type: "finalists-without-recommendation",
      terminal: true,
      crownable: false,
      finalistCount,
      validationPosture,
      verificationLevel,
      validationGapCount,
      judgingBasisKind,
    };
  }

  if (validationGapCount > 0) {
    return {
      type: "completed-with-validation-gaps",
      terminal: true,
      crownable: false,
      finalistCount,
      validationPosture,
      verificationLevel,
      validationGapCount,
      judgingBasisKind,
    };
  }

  return {
    type: "no-survivors",
    terminal: true,
    crownable: false,
    finalistCount,
    validationPosture,
    verificationLevel,
    validationGapCount,
    judgingBasisKind,
  };
}

export function deriveConsultationOutcomeForManifest(
  manifest: ConsultationOutcomeManifestInput,
): ConsultationOutcome {
  return deriveConsultationOutcome({
    status: manifest.status,
    candidates: manifest.candidates,
    ...(manifest.rounds ? { rounds: manifest.rounds } : {}),
    ...(manifest.profileSelection
      ? {
          profileSelection: {
            validationGaps: getValidationGaps(manifest.profileSelection),
            oracleIds: manifest.profileSelection.oracleIds,
          },
        }
      : {}),
    ...(manifest.recommendedWinner
      ? {
          recommendedWinner: {
            candidateId: manifest.recommendedWinner.candidateId,
          },
        }
      : {}),
  });
}

export function buildBlockedPreflightOutcome(
  preflight: ConsultationPreflight,
): ConsultationOutcome {
  if (preflight.decision === "needs-clarification") {
    return {
      type: "needs-clarification",
      terminal: true,
      crownable: false,
      finalistCount: 0,
      validationPosture: "unknown",
      verificationLevel: "none",
      validationGapCount: 0,
      judgingBasisKind: "unknown",
    };
  }

  if (preflight.decision === "external-research-required") {
    return {
      type: "external-research-required",
      terminal: true,
      crownable: false,
      finalistCount: 0,
      validationPosture: "validation-gaps",
      verificationLevel: "none",
      validationGapCount: 0,
      judgingBasisKind: "unknown",
    };
  }

  return {
    type: "abstained-before-execution",
    terminal: true,
    crownable: false,
    finalistCount: 0,
    validationPosture: "unknown",
    verificationLevel: "none",
    validationGapCount: 0,
    judgingBasisKind: "unknown",
  };
}

export function isPreflightBlockedConsultation(manifest: Pick<RunManifest, "preflight">): boolean {
  return (
    manifest.preflight?.decision === "needs-clarification" ||
    manifest.preflight?.decision === "external-research-required" ||
    manifest.preflight?.decision === "abstain"
  );
}

function deriveVerificationLevel(
  rounds: ConsultationOutcomeInput["rounds"],
  validationGapCount: number,
): ConsultationOutcome["verificationLevel"] {
  const completedRounds = new Set(
    (rounds ?? [])
      .filter((round) => round.status === "completed" && round.verdictCount > 0)
      .map((round) => round.id),
  );

  if (completedRounds.size === 0) {
    return "none";
  }

  if (completedRounds.has("deep") && validationGapCount === 0) {
    return "thorough";
  }

  if (completedRounds.has("impact") || completedRounds.has("deep")) {
    return "standard";
  }

  return "lightweight";
}
