import type { UserInteraction } from "../../domain/chat-native.js";
import type { RunManifest } from "../../domain/run.js";
import type { ConsultationArtifactState } from "../consultation-artifacts.js";
import { normalizePlanningSuggestedAnswers } from "../planning-interview/index.js";

export type UserInteractionSurface = "plan" | "consult";

const PLAN_CLARIFICATION_EXPECTED_ANSWER =
  "Answer with the missing task intent, scope boundary, success criteria, non-goal, or judging basis.";

const CONSULT_CLARIFICATION_EXPECTED_ANSWER =
  "Answer with the missing implementation scope, target artifact, acceptance signal, or constraint needed before candidate execution.";

export function buildUserInteraction(options: {
  manifest: RunManifest;
  artifacts: ConsultationArtifactState;
  surface: UserInteractionSurface;
}): UserInteraction | undefined {
  const auguryInteraction = buildAuguryInteraction(options.artifacts);
  if (auguryInteraction) {
    return auguryInteraction;
  }
  if (options.artifacts.planningInterview?.status === "needs-clarification") {
    return undefined;
  }

  const clarificationQuestion = options.manifest.preflight?.clarificationQuestion?.trim();
  if (options.manifest.preflight?.decision !== "needs-clarification" || !clarificationQuestion) {
    return undefined;
  }

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
