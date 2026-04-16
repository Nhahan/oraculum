import type { z } from "zod";

import type { AgentRunResult } from "../../adapters/types.js";
import type { ManagedTreeRules } from "../../domain/config.js";
import type { OracleVerdict } from "../../domain/oracle.js";
import {
  type CandidateManifest,
  type ConsultationPlanArtifact,
  type candidateScorecardSchema,
  finalistScorecardBundleSchema,
} from "../../domain/run.js";

import { buildEnrichedFinalistSummaries } from "../finalist-insights.js";
import { RunStore } from "../run-store.js";

export type JudgableFinalists = Awaited<ReturnType<typeof buildEnrichedFinalistSummaries>>;

export async function buildJudgableFinalists(options: {
  candidateResults: AgentRunResult[];
  candidates: CandidateManifest[];
  consultationPlan?: ConsultationPlanArtifact;
  managedTreeRules?: ManagedTreeRules;
  projectRoot: string;
  runId: string;
  verdictsByCandidate: Map<string, OracleVerdict[]>;
}): Promise<JudgableFinalists> {
  const finalists = await buildEnrichedFinalistSummaries({
    candidates: options.candidates,
    candidateResults: options.candidateResults,
    ...(options.managedTreeRules ? { managedTreeRules: options.managedTreeRules } : {}),
    verdictsByCandidate: options.verdictsByCandidate,
  });
  return attachPlannedScorecards({
    finalists,
    candidates: options.candidates,
    projectRoot: options.projectRoot,
    runId: options.runId,
    ...(options.consultationPlan ? { consultationPlan: options.consultationPlan } : {}),
  });
}

export async function persistFinalistScorecards(options: {
  finalists: JudgableFinalists;
  projectRoot: string;
  runId: string;
}): Promise<void> {
  const store = new RunStore(options.projectRoot);
  const finalistsWithScorecards = options.finalists.filter((finalist) => finalist.plannedScorecard);
  if (finalistsWithScorecards.length === 0) {
    return;
  }

  const artifact = finalistScorecardBundleSchema.parse({
    runId: options.runId,
    generatedAt: new Date().toISOString(),
    finalists: finalistsWithScorecards.map((finalist) => ({
      candidateId: finalist.candidateId,
      strategyLabel: finalist.strategyLabel,
      ...finalist.plannedScorecard,
    })),
  });
  await store.writeJsonArtifact(store.getRunPaths(options.runId).finalistScorecardsPath, artifact);
}

async function attachPlannedScorecards(options: {
  finalists: JudgableFinalists;
  candidates: CandidateManifest[];
  consultationPlan?: ConsultationPlanArtifact;
  projectRoot: string;
  runId: string;
}): Promise<JudgableFinalists> {
  const store = new RunStore(options.projectRoot);
  if (
    !options.consultationPlan ||
    options.consultationPlan.mode === "standard" ||
    options.consultationPlan.stagePlan.length === 0
  ) {
    return options.finalists;
  }

  const candidateById = new Map(options.candidates.map((candidate) => [candidate.id, candidate]));
  const scorecardsByCandidateId = new Map<string, z.infer<typeof candidateScorecardSchema>>();

  await Promise.all(
    options.finalists.map(async (finalist) => {
      const candidate = candidateById.get(finalist.candidateId);
      if (!candidate || candidate.status !== "promoted") {
        return;
      }

      try {
        const parsedScorecard = await store.readCandidateScorecard(
          options.runId,
          finalist.candidateId,
        );
        if (parsedScorecard) {
          scorecardsByCandidateId.set(finalist.candidateId, parsedScorecard);
        }
      } catch {
        return;
      }
    }),
  );

  return options.finalists.map((finalist) => {
    const scorecard = scorecardsByCandidateId.get(finalist.candidateId);
    return scorecard
      ? {
          ...finalist,
          plannedScorecard: omitCandidateIdFromScorecard(scorecard),
        }
      : finalist;
  });
}

function omitCandidateIdFromScorecard(
  scorecard: z.infer<typeof candidateScorecardSchema>,
): JudgableFinalists[number]["plannedScorecard"] {
  const { candidateId: _candidateId, ...rest } = scorecard;
  return rest;
}
