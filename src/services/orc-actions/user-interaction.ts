import type { UserInteraction } from "../../domain/chat-native.js";
import { deriveConsultationOutcomeForManifest, type RunManifest } from "../../domain/run.js";
import type { ConsultationArtifactState } from "../consultation-artifacts.js";
import { normalizePlanningSuggestedAnswers } from "../planning-interview/index.js";

export type UserInteractionSurface = "plan" | "consult";

const PLAN_CLARIFICATION_EXPECTED_ANSWER =
  "Answer with the missing task intent, scope boundary, success criteria, non-goal, or judging basis.";

const CONSULT_CLARIFICATION_EXPECTED_ANSWER =
  "Answer with the missing implementation scope, target artifact, acceptance signal, or constraint needed before candidate execution.";

const APPLY_APPROVAL_EXPECTED_WORKSPACE_SYNC =
  "Choose Apply, choose Do not apply, or enter an optional materialization label to apply with that label.";

const APPLY_APPROVAL_EXPECTED_GIT_BRANCH =
  "Answer with the target branch name to create for the recommended result, for example fix/session-loss.";

export function buildUserInteraction(options: {
  manifest: RunManifest;
  artifacts: ConsultationArtifactState;
  surface: UserInteractionSurface;
  deferApply?: boolean | undefined;
}): UserInteraction | undefined {
  const auguryInteraction = buildAuguryInteraction(options.artifacts);
  if (auguryInteraction) {
    return auguryInteraction;
  }
  if (options.artifacts.planningInterview?.status === "needs-clarification") {
    return undefined;
  }

  const clarificationQuestion = options.manifest.preflight?.clarificationQuestion?.trim();
  if (options.manifest.preflight?.decision === "needs-clarification" && clarificationQuestion) {
    return {
      kind: options.surface === "plan" ? "plan-clarification" : "consult-clarification",
      runId: options.manifest.id,
      header: options.surface === "plan" ? "Plan clarification" : "Consult clarification",
      question: clarificationQuestion,
      expectedAnswerShape:
        options.surface === "plan"
          ? PLAN_CLARIFICATION_EXPECTED_ANSWER
          : CONSULT_CLARIFICATION_EXPECTED_ANSWER,
      freeTextAllowed: true,
    };
  }

  if (options.surface !== "consult" || options.deferApply === true) {
    return undefined;
  }

  return buildApplyApprovalInteraction(options.manifest, options.artifacts);
}

export function inferVerdictUserInteractionSurface(options: {
  manifest: RunManifest;
  artifacts: ConsultationArtifactState;
}): UserInteractionSurface {
  if (options.manifest.taskPacket.sourceKind === "consultation-plan") {
    return "consult";
  }

  if (
    !options.artifacts.planningSourceRunId &&
    (options.artifacts.planningDepth?.runId === options.manifest.id ||
      options.artifacts.planningInterview?.runId === options.manifest.id ||
      options.artifacts.planningSpec?.runId === options.manifest.id ||
      options.artifacts.planConsensus?.runId === options.manifest.id)
  ) {
    return "plan";
  }

  return "consult";
}

function buildAuguryInteraction(artifacts: ConsultationArtifactState): UserInteraction | undefined {
  const interview = artifacts.planningInterview;
  if (!interview || interview.status !== "needs-clarification") {
    return undefined;
  }

  const latestRound = interview.rounds.at(-1);
  const question = interview.nextQuestion ?? latestRound?.question;
  const maxRounds = artifacts.planningDepth?.maxInterviewRounds ?? latestRound?.round;
  if (!latestRound || !question || maxRounds === undefined || latestRound.round > maxRounds) {
    return undefined;
  }

  const options = normalizePlanningSuggestedAnswers(latestRound.suggestedAnswers);

  return {
    kind: "augury-question",
    runId: interview.runId,
    header: "Augury",
    question,
    expectedAnswerShape: latestRound.expectedAnswerShape ?? PLAN_CLARIFICATION_EXPECTED_ANSWER,
    ...(options.length >= 2 ? { options } : {}),
    freeTextAllowed: true,
    round: latestRound.round,
    maxRounds,
  };
}

function buildApplyApprovalInteraction(
  manifest: RunManifest,
  artifacts: ConsultationArtifactState,
): UserInteraction | undefined {
  if (!isApplyApprovalEligible(manifest, artifacts)) {
    return undefined;
  }

  const candidateId =
    manifest.recommendedWinner?.candidateId ?? manifest.outcome?.recommendedCandidateId;
  const winner = manifest.candidates.find((candidate) => candidate.id === candidateId);
  if (!winner?.workspaceMode) {
    return undefined;
  }

  if (winner.workspaceMode === "git-worktree") {
    return {
      kind: "apply-approval",
      runId: manifest.id,
      header: "Apply recommended result",
      question: `Enter the branch name to create for recommended candidate ${winner.id}.`,
      expectedAnswerShape: APPLY_APPROVAL_EXPECTED_GIT_BRANCH,
      freeTextAllowed: true,
    };
  }

  return {
    kind: "apply-approval",
    runId: manifest.id,
    header: "Apply recommended result",
    question: `Apply recommended candidate ${winner.id} to this workspace?`,
    expectedAnswerShape: APPLY_APPROVAL_EXPECTED_WORKSPACE_SYNC,
    options: [
      {
        label: "Apply",
        description: "Materialize the recommended result in the project workspace.",
      },
      {
        label: "Do not apply",
        description: "Keep the verdict only and leave the project workspace unchanged.",
      },
    ],
    freeTextAllowed: true,
  };
}

export function isApplyApprovalEligible(
  manifest: RunManifest,
  artifacts: ConsultationArtifactState,
): boolean {
  const outcome = manifest.outcome ?? deriveConsultationOutcomeForManifest(manifest);
  const candidateId = manifest.recommendedWinner?.candidateId ?? outcome.recommendedCandidateId;
  const winner = manifest.candidates.find((candidate) => candidate.id === candidateId);

  return Boolean(
    manifest.status === "completed" &&
      outcome.type === "recommended-survivor" &&
      outcome.crownable &&
      outcome.validationGapCount === 0 &&
      manifest.recommendedWinner &&
      manifest.recommendedWinner.source !== "fallback-policy" &&
      winner &&
      winner.status === "promoted" &&
      winner.workspaceMode &&
      !artifacts.crowningRecordAvailable &&
      !artifacts.hasExportedCandidate &&
      !artifacts.manualReviewRequired &&
      !hasInvalidSecondOpinionArtifact(artifacts),
  );
}

function hasInvalidSecondOpinionArtifact(artifacts: ConsultationArtifactState): boolean {
  return artifacts.artifactDiagnostics.some(
    (diagnostic) => diagnostic.kind === "winner-selection-second-opinion",
  );
}
