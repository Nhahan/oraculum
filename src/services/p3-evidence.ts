import { mkdir, readFile } from "node:fs/promises";

import { z } from "zod";

import { agentJudgeResultSchema } from "../adapters/types.js";
import {
  getFailureAnalysisPath,
  getFinalistComparisonJsonPath,
  getFinalistComparisonMarkdownPath,
  getOraculumDir,
  getP3EvidencePath,
  getPreflightReadinessPath,
  getProfileSelectionPath,
  getResearchBriefPath,
  getRunDir,
  getRunManifestPath,
  getWinnerSelectionPath,
  resolveProjectRoot,
} from "../core/paths.js";
import { adapterSchema } from "../domain/config.js";
import { decisionConfidenceSchema } from "../domain/profile.js";
import {
  consultationOutcomeTypeSchema,
  consultationValidationPostureSchema,
} from "../domain/run.js";
import {
  taskResearchBasisStatusSchema,
  taskResearchConflictHandlingSchema,
  taskSourceKindSchema,
} from "../domain/task.js";

import { buildVerdictReview, listRecentConsultations } from "./consultations.js";
import { failureAnalysisSchema } from "./failure-analysis.js";
import { pathExists, writeJsonFile } from "./project.js";

const p3EvidenceCaseKindSchema = z.enum([
  "clarify-needed",
  "external-research-required",
  "finalists-without-recommendation",
  "judge-abstain",
  "manual-crowning-handoff",
  "low-confidence-recommendation",
]);

const p3EvidenceCaseSchema = z.object({
  kind: p3EvidenceCaseKindSchema,
  runId: z.string().min(1),
  consultationPath: z.string().min(1),
  openedAt: z.string().min(1),
  agent: adapterSchema,
  taskTitle: z.string().min(1),
  taskSourceKind: taskSourceKindSchema,
  taskSourcePath: z.string().min(1),
  targetArtifactPath: z.string().min(1).optional(),
  outcomeType: consultationOutcomeTypeSchema,
  outcomeSummary: z.string().min(1),
  validationPosture: consultationValidationPostureSchema,
  researchBasisStatus: taskResearchBasisStatusSchema,
  researchConflictHandling: taskResearchConflictHandlingSchema.optional(),
  researchRerunRecommended: z.boolean(),
  manualReviewRecommended: z.boolean(),
  preflightFallbackObserved: z.boolean().default(false),
  summary: z.string().min(1),
  supportingEvidence: z.array(z.string().min(1)).default([]),
  blockingEvidence: z.array(z.string().min(1)).default([]),
  artifactPaths: z
    .object({
      preflightReadinessPath: z.string().min(1).optional(),
      researchBriefPath: z.string().min(1).optional(),
      failureAnalysisPath: z.string().min(1).optional(),
      winnerSelectionPath: z.string().min(1).optional(),
      comparisonJsonPath: z.string().min(1).optional(),
      comparisonMarkdownPath: z.string().min(1).optional(),
    })
    .default({}),
  question: z.string().min(1).optional(),
  candidateIds: z.array(z.string().min(1)).default([]),
  candidateStrategyLabels: z.array(z.string().min(1)).default([]),
  judgingCriteria: z.array(z.string().min(1)).min(1).max(5).optional(),
  confidence: decisionConfidenceSchema.optional(),
});

const p3RepeatedTaskSchema = z.object({
  taskTitle: z.string().min(1),
  targetArtifactPath: z.string().min(1).optional(),
  occurrenceCount: z.number().int().min(2),
  latestRunId: z.string().min(1),
  latestOpenedAt: z.string().min(1),
  kinds: z.array(p3EvidenceCaseKindSchema).min(1),
});

const p3RepeatedSourceSchema = z.object({
  taskSourceKind: taskSourceKindSchema,
  taskSourcePath: z.string().min(1),
  occurrenceCount: z.number().int().min(2),
  latestRunId: z.string().min(1),
  latestOpenedAt: z.string().min(1),
  taskTitles: z.array(z.string().min(1)).min(1),
  kinds: z.array(p3EvidenceCaseKindSchema).min(1),
});

const p3RecurringReasonSchema = z.object({
  label: z.string().min(1),
  occurrenceCount: z.number().int().min(2),
  latestRunId: z.string().min(1),
  latestOpenedAt: z.string().min(1),
  kinds: z.array(p3EvidenceCaseKindSchema).min(1),
});

const p3RepeatedTargetSchema = z.object({
  targetArtifactPath: z.string().min(1),
  occurrenceCount: z.number().int().min(2),
  latestRunId: z.string().min(1),
  latestOpenedAt: z.string().min(1),
  taskTitles: z.array(z.string().min(1)).min(1),
  kinds: z.array(p3EvidenceCaseKindSchema).min(1),
});

const p3RepeatedStrategySetSchema = z.object({
  strategyLabels: z.array(z.string().min(1)).min(1),
  occurrenceCount: z.number().int().min(2),
  latestRunId: z.string().min(1),
  latestOpenedAt: z.string().min(1),
  taskTitles: z.array(z.string().min(1)).min(1),
  kinds: z.array(p3EvidenceCaseKindSchema).min(1),
});

const p3RepeatedJudgingCriteriaSetSchema = z.object({
  judgingCriteria: z.array(z.string().min(1)).min(1),
  occurrenceCount: z.number().int().min(2),
  latestRunId: z.string().min(1),
  latestOpenedAt: z.string().min(1),
  taskTitles: z.array(z.string().min(1)).min(1),
  kinds: z.array(p3EvidenceCaseKindSchema).min(1),
});

const p3PromotionSignalSchema = z.object({
  shouldPromote: z.boolean(),
  distinctRunCount: z.number().int().min(0),
  reasons: z.array(z.string().min(1)).default([]),
});

const p3MissingArtifactKindSchema = z.enum([
  "preflight-readiness",
  "research-brief",
  "winner-selection",
  "comparison-report",
  "failure-analysis",
]);

const p3AgentBreakdownSchema = z.object({
  agent: adapterSchema,
  caseCount: z.number().int().min(1),
  consultationCount: z.number().int().min(1),
});

const p3PressureTrajectoryRunSchema = z.object({
  runId: z.string().min(1),
  openedAt: z.string().min(1),
  agent: adapterSchema,
  taskTitle: z.string().min(1),
  kinds: z.array(p3EvidenceCaseKindSchema).min(1),
});

const p3PressureTrajectorySchema = z.object({
  keyType: z.enum(["target-artifact", "task-source"]),
  key: z.string().min(1),
  occurrenceCount: z.number().int().min(2),
  latestRunId: z.string().min(1),
  latestOpenedAt: z.string().min(1),
  daySpanDays: z.number().int().min(0),
  agents: z.array(adapterSchema).min(1),
  distinctKinds: z.array(p3EvidenceCaseKindSchema).min(2),
  containsEscalation: z.boolean(),
  runs: z.array(p3PressureTrajectoryRunSchema).min(2),
});

const p3InspectionItemSchema = z.object({
  artifactKind: z.enum([
    "preflight-readiness",
    "research-brief",
    "winner-selection",
    "comparison-json",
    "comparison-markdown",
    "failure-analysis",
    "run-manifest",
  ]),
  runId: z.string().min(1),
  openedAt: z.string().min(1),
  reason: z.string().min(1),
  path: z.string().min(1),
});

const p3CoverageGapRunSchema = z.object({
  runId: z.string().min(1),
  openedAt: z.string().min(1),
  agent: adapterSchema,
  taskTitle: z.string().min(1),
  taskSourceKind: taskSourceKindSchema,
  taskSourcePath: z.string().min(1),
  targetArtifactPath: z.string().min(1).optional(),
  consultationPath: z.string().min(1),
  manifestPath: z.string().min(1),
  kinds: z.array(p3EvidenceCaseKindSchema).min(1),
  missingArtifactKinds: z.array(p3MissingArtifactKindSchema).min(1),
});

const p3MissingArtifactBreakdownSchema = z.object({
  artifactKind: p3MissingArtifactKindSchema,
  consultationCount: z.number().int().min(1),
});

const p3RecentClusterSchema = z.object({
  windowDays: z.number().int().min(1),
  recentRunCount: z.number().int().min(0),
  latestRunId: z.string().min(1).optional(),
  latestOpenedAt: z.string().min(1).optional(),
});

const p3ArtifactCoverageSchema = z.object({
  consultationsWithPreflightReadiness: z.number().int().min(0),
  consultationsWithPreflightFallback: z.number().int().min(0),
  consultationsWithComparisonReport: z.number().int().min(0),
  consultationsWithWinnerSelection: z.number().int().min(0),
  consultationsWithFailureAnalysis: z.number().int().min(0),
  consultationsWithResearchBrief: z.number().int().min(0),
  consultationsWithManualReviewRecommendation: z.number().int().min(0),
});

const p3PressureMetadataCoverageSchema = z.object({
  consultationCount: z.number().int().min(0),
  consultationsWithValidationGaps: z.number().int().min(0),
  consultationsWithCurrentResearchBasis: z.number().int().min(0),
  consultationsWithStaleResearchBasis: z.number().int().min(0),
  consultationsWithUnknownResearchBasis: z.number().int().min(0),
  consultationsWithResearchConflicts: z.number().int().min(0),
  consultationsWithResearchRerunRecommended: z.number().int().min(0),
  consultationsWithJudgingCriteria: z.number().int().min(0),
});

const p3PressureArtifactCoverageSchema = z.object({
  caseCount: z.number().int().min(0),
  casesWithTargetArtifact: z.number().int().min(0),
  casesWithPreflightReadiness: z.number().int().min(0),
  casesWithPreflightFallback: z.number().int().min(0),
  casesWithComparisonReport: z.number().int().min(0),
  casesWithWinnerSelection: z.number().int().min(0),
  casesWithFailureAnalysis: z.number().int().min(0),
  casesWithResearchBrief: z.number().int().min(0),
  casesWithManualReviewRecommendation: z.number().int().min(0),
});

const p3ClarifyPressureSchema = z.object({
  totalCases: z.number().int().min(0),
  needsClarificationCases: z.number().int().min(0),
  externalResearchRequiredCases: z.number().int().min(0),
  artifactCoverage: p3PressureArtifactCoverageSchema,
  metadataCoverage: p3PressureMetadataCoverageSchema,
  recentCluster: p3RecentClusterSchema,
  agentBreakdown: z.array(p3AgentBreakdownSchema).default([]),
  repeatedTasks: z.array(p3RepeatedTaskSchema).default([]),
  repeatedSources: z.array(p3RepeatedSourceSchema).default([]),
  repeatedTargets: z.array(p3RepeatedTargetSchema).default([]),
  pressureTrajectories: z.array(p3PressureTrajectorySchema).default([]),
  recurringReasons: z.array(p3RecurringReasonSchema).default([]),
  coverageGapRuns: z.array(p3CoverageGapRunSchema).default([]),
  missingArtifactBreakdown: z.array(p3MissingArtifactBreakdownSchema).default([]),
  inspectionQueue: z.array(p3InspectionItemSchema).default([]),
  coverageBlindSpots: z.array(z.string().min(1)).default([]),
  promotionSignal: p3PromotionSignalSchema,
  cases: z.array(p3EvidenceCaseSchema).default([]),
});

const p3FinalistSelectionPressureSchema = z.object({
  totalCases: z.number().int().min(0),
  finalistsWithoutRecommendationCases: z.number().int().min(0),
  judgeAbstainCases: z.number().int().min(0),
  manualCrowningCases: z.number().int().min(0),
  lowConfidenceRecommendationCases: z.number().int().min(0),
  artifactCoverage: p3PressureArtifactCoverageSchema,
  metadataCoverage: p3PressureMetadataCoverageSchema,
  recentCluster: p3RecentClusterSchema,
  agentBreakdown: z.array(p3AgentBreakdownSchema).default([]),
  repeatedTasks: z.array(p3RepeatedTaskSchema).default([]),
  repeatedSources: z.array(p3RepeatedSourceSchema).default([]),
  repeatedTargets: z.array(p3RepeatedTargetSchema).default([]),
  repeatedStrategySets: z.array(p3RepeatedStrategySetSchema).default([]),
  repeatedJudgingCriteriaSets: z.array(p3RepeatedJudgingCriteriaSetSchema).default([]),
  pressureTrajectories: z.array(p3PressureTrajectorySchema).default([]),
  recurringReasons: z.array(p3RecurringReasonSchema).default([]),
  coverageGapRuns: z.array(p3CoverageGapRunSchema).default([]),
  missingArtifactBreakdown: z.array(p3MissingArtifactBreakdownSchema).default([]),
  inspectionQueue: z.array(p3InspectionItemSchema).default([]),
  coverageBlindSpots: z.array(z.string().min(1)).default([]),
  promotionSignal: p3PromotionSignalSchema,
  cases: z.array(p3EvidenceCaseSchema).default([]),
});

export const p3EvidenceReportSchema = z.object({
  generatedAt: z.string().min(1),
  projectRoot: z.string().min(1),
  consultationCount: z.number().int().min(0),
  artifactCoverage: p3ArtifactCoverageSchema,
  clarifyPressure: p3ClarifyPressureSchema,
  finalistSelectionPressure: p3FinalistSelectionPressureSchema,
});

export type P3EvidenceReport = z.infer<typeof p3EvidenceReportSchema>;

export async function collectP3Evidence(cwd: string): Promise<P3EvidenceReport> {
  const projectRoot = resolveProjectRoot(cwd);
  const manifests = await listRecentConsultations(projectRoot, Number.MAX_SAFE_INTEGER);
  const clarifyCases: z.infer<typeof p3EvidenceCaseSchema>[] = [];
  const finalistSelectionCases: z.infer<typeof p3EvidenceCaseSchema>[] = [];
  const artifactCoverage = {
    consultationsWithPreflightReadiness: 0,
    consultationsWithPreflightFallback: 0,
    consultationsWithComparisonReport: 0,
    consultationsWithWinnerSelection: 0,
    consultationsWithFailureAnalysis: 0,
    consultationsWithResearchBrief: 0,
    consultationsWithManualReviewRecommendation: 0,
  };

  for (const manifest of manifests) {
    const artifacts = await resolveConsultationArtifacts(projectRoot, manifest.id);
    const preflightReadiness = await readPreflightReadiness(artifacts.preflightReadinessPath);
    if (artifacts.preflightReadinessPath) {
      artifactCoverage.consultationsWithPreflightReadiness += 1;
    }
    if (preflightReadiness?.llmSkipped || preflightReadiness?.llmFailure) {
      artifactCoverage.consultationsWithPreflightFallback += 1;
    }
    if (artifacts.comparisonJsonPath || artifacts.comparisonMarkdownPath) {
      artifactCoverage.consultationsWithComparisonReport += 1;
    }
    if (artifacts.winnerSelectionPath) {
      artifactCoverage.consultationsWithWinnerSelection += 1;
    }
    if (artifacts.failureAnalysisPath) {
      artifactCoverage.consultationsWithFailureAnalysis += 1;
    }
    if (artifacts.researchBriefPath) {
      artifactCoverage.consultationsWithResearchBrief += 1;
    }
    const review = await buildVerdictReview(manifest, artifacts);
    if (review.manualReviewRecommended) {
      artifactCoverage.consultationsWithManualReviewRecommendation += 1;
    }
    const winnerSelection = await readWinnerSelection(artifacts.winnerSelectionPath);
    const failureAnalysis = await readFailureAnalysis(artifacts.failureAnalysisPath);
    const common = {
      runId: manifest.id,
      consultationPath: getRunDir(projectRoot, manifest.id),
      openedAt: manifest.createdAt,
      agent: manifest.agent,
      taskTitle: manifest.taskPacket.title,
      taskSourceKind: manifest.taskPacket.sourceKind,
      taskSourcePath: manifest.taskPacket.sourcePath,
      outcomeType: review.outcomeType,
      outcomeSummary: review.outcomeSummary,
      validationPosture: review.validationPosture,
      researchBasisStatus: review.researchBasisStatus,
      ...(review.researchConflictHandling
        ? { researchConflictHandling: review.researchConflictHandling }
        : {}),
      researchRerunRecommended: review.researchRerunRecommended,
      manualReviewRecommended: review.manualReviewRecommended,
      preflightFallbackObserved: Boolean(
        preflightReadiness?.llmSkipped || preflightReadiness?.llmFailure,
      ),
      supportingEvidence: limitEvidence(review.strongestEvidence),
      blockingEvidence: limitEvidence(review.weakestEvidence),
      artifactPaths: {
        ...(artifacts.preflightReadinessPath
          ? { preflightReadinessPath: artifacts.preflightReadinessPath }
          : {}),
        ...(artifacts.researchBriefPath ? { researchBriefPath: artifacts.researchBriefPath } : {}),
        ...(artifacts.failureAnalysisPath
          ? { failureAnalysisPath: artifacts.failureAnalysisPath }
          : {}),
        ...(artifacts.winnerSelectionPath
          ? { winnerSelectionPath: artifacts.winnerSelectionPath }
          : {}),
        ...(artifacts.comparisonJsonPath
          ? { comparisonJsonPath: artifacts.comparisonJsonPath }
          : {}),
        ...(artifacts.comparisonMarkdownPath
          ? { comparisonMarkdownPath: artifacts.comparisonMarkdownPath }
          : {}),
      },
      ...(manifest.taskPacket.targetArtifactPath
        ? { targetArtifactPath: manifest.taskPacket.targetArtifactPath }
        : {}),
    } as const;

    if (review.outcomeType === "needs-clarification") {
      clarifyCases.push(
        p3EvidenceCaseSchema.parse({
          ...common,
          kind: "clarify-needed",
          summary:
            review.recommendationAbsenceReason ??
            "Execution stopped because operator clarification is still required.",
          ...(review.clarificationQuestion ? { question: review.clarificationQuestion } : {}),
          ...(review.judgingCriteria?.length ? { judgingCriteria: review.judgingCriteria } : {}),
        }),
      );
    }

    if (review.outcomeType === "external-research-required") {
      clarifyCases.push(
        p3EvidenceCaseSchema.parse({
          ...common,
          kind: "external-research-required",
          summary:
            review.recommendationAbsenceReason ??
            "Execution stopped because bounded external research is still required.",
          ...(review.researchQuestion ? { question: review.researchQuestion } : {}),
          ...(review.judgingCriteria?.length ? { judgingCriteria: review.judgingCriteria } : {}),
        }),
      );
    }

    if (review.outcomeType === "finalists-without-recommendation") {
      finalistSelectionCases.push(
        p3EvidenceCaseSchema.parse({
          ...common,
          kind: "finalists-without-recommendation",
          summary:
            review.recommendationAbsenceReason ??
            failureAnalysis?.summary ??
            "Finalists survived without a recorded recommendation.",
          candidateIds: review.finalistIds,
          candidateStrategyLabels: resolveCandidateStrategyLabels(manifest, review.finalistIds),
          ...(review.judgingCriteria?.length ? { judgingCriteria: review.judgingCriteria } : {}),
        }),
      );
    }

    if (winnerSelection?.recommendation?.decision === "abstain") {
      finalistSelectionCases.push(
        p3EvidenceCaseSchema.parse({
          ...common,
          kind: "judge-abstain",
          summary:
            winnerSelection.recommendation.summary ??
            failureAnalysis?.summary ??
            "The finalist judge abstained.",
          candidateIds: review.finalistIds,
          candidateStrategyLabels: resolveCandidateStrategyLabels(manifest, review.finalistIds),
          ...(review.judgingCriteria?.length ? { judgingCriteria: review.judgingCriteria } : {}),
          confidence: winnerSelection.recommendation.confidence,
        }),
      );
    }

    if (review.manualCrowningCandidateIds.length > 0) {
      finalistSelectionCases.push(
        p3EvidenceCaseSchema.parse({
          ...common,
          kind: "manual-crowning-handoff",
          summary:
            review.manualCrowningReason ??
            "Manual crowning requires operator judgment for the surviving finalists.",
          candidateIds: review.manualCrowningCandidateIds,
          candidateStrategyLabels: resolveCandidateStrategyLabels(
            manifest,
            review.manualCrowningCandidateIds,
          ),
          ...(review.judgingCriteria?.length ? { judgingCriteria: review.judgingCriteria } : {}),
        }),
      );
    }

    const recommendationConfidence =
      winnerSelection?.recommendation?.decision === "select"
        ? winnerSelection.recommendation.confidence
        : manifest.recommendedWinner?.confidence;
    if (review.outcomeType === "recommended-survivor" && recommendationConfidence === "low") {
      finalistSelectionCases.push(
        p3EvidenceCaseSchema.parse({
          ...common,
          kind: "low-confidence-recommendation",
          summary:
            review.recommendationSummary ??
            manifest.recommendedWinner?.summary ??
            "A recommended result was selected with low confidence.",
          candidateIds: review.recommendedCandidateId ? [review.recommendedCandidateId] : [],
          candidateStrategyLabels: resolveCandidateStrategyLabels(
            manifest,
            review.recommendedCandidateId ? [review.recommendedCandidateId] : [],
          ),
          ...(review.judgingCriteria?.length ? { judgingCriteria: review.judgingCriteria } : {}),
          confidence: recommendationConfidence,
        }),
      );
    }
  }

  const clarifyRepeatedTasks = buildRepeatedTasks(clarifyCases);
  const clarifyRepeatedSources = buildRepeatedSources(clarifyCases);
  const clarifyRepeatedTargets = buildRepeatedTargets(clarifyCases);
  const clarifyRecentCluster = buildRecentCluster(clarifyCases);
  const clarifyAgentBreakdown = buildAgentBreakdown(clarifyCases);
  const clarifyPressureTrajectories = buildPressureTrajectories(clarifyCases);
  const clarifyRecurringReasons = buildRecurringReasons(
    clarifyCases,
    (item) => item.question ?? item.summary,
  );
  const clarifyArtifactCoverage = buildPressureArtifactCoverage(clarifyCases);
  const clarifyMetadataCoverage = buildPressureMetadataCoverage(clarifyCases);
  const clarifyCoverageGapRuns = buildCoverageGapRuns(
    projectRoot,
    clarifyCases,
    getClarifyMissingArtifacts,
  );
  const clarifyMissingArtifactBreakdown = buildMissingArtifactBreakdown(clarifyCoverageGapRuns);
  const clarifyInspectionQueue = buildClarifyInspectionQueue(
    projectRoot,
    clarifyCases,
    clarifyCoverageGapRuns,
  );
  const finalistRepeatedTasks = buildRepeatedTasks(finalistSelectionCases);
  const finalistRepeatedSources = buildRepeatedSources(finalistSelectionCases);
  const finalistRepeatedTargets = buildRepeatedTargets(finalistSelectionCases);
  const finalistRepeatedStrategySets = buildRepeatedStrategySets(finalistSelectionCases);
  const finalistRepeatedJudgingCriteriaSets =
    buildRepeatedJudgingCriteriaSets(finalistSelectionCases);
  const finalistRecentCluster = buildRecentCluster(finalistSelectionCases);
  const finalistAgentBreakdown = buildAgentBreakdown(finalistSelectionCases);
  const finalistPressureTrajectories = buildPressureTrajectories(finalistSelectionCases);
  const finalistRecurringReasons = buildRecurringReasons(
    finalistSelectionCases,
    (item) => item.summary,
  );
  const finalistArtifactCoverage = buildPressureArtifactCoverage(finalistSelectionCases);
  const finalistMetadataCoverage = buildPressureMetadataCoverage(finalistSelectionCases);
  const finalistCoverageGapRuns = buildCoverageGapRuns(
    projectRoot,
    finalistSelectionCases,
    getFinalistMissingArtifacts,
  );
  const finalistMissingArtifactBreakdown = buildMissingArtifactBreakdown(finalistCoverageGapRuns);
  const finalistInspectionQueue = buildFinalistInspectionQueue(
    projectRoot,
    finalistSelectionCases,
    finalistCoverageGapRuns,
  );

  return p3EvidenceReportSchema.parse({
    generatedAt: new Date().toISOString(),
    projectRoot,
    consultationCount: manifests.length,
    artifactCoverage,
    clarifyPressure: {
      totalCases: clarifyCases.length,
      needsClarificationCases: clarifyCases.filter((item) => item.kind === "clarify-needed").length,
      externalResearchRequiredCases: clarifyCases.filter(
        (item) => item.kind === "external-research-required",
      ).length,
      artifactCoverage: clarifyArtifactCoverage,
      metadataCoverage: clarifyMetadataCoverage,
      recentCluster: clarifyRecentCluster,
      agentBreakdown: clarifyAgentBreakdown,
      repeatedTasks: clarifyRepeatedTasks,
      repeatedSources: clarifyRepeatedSources,
      repeatedTargets: clarifyRepeatedTargets,
      pressureTrajectories: clarifyPressureTrajectories,
      recurringReasons: clarifyRecurringReasons,
      coverageGapRuns: clarifyCoverageGapRuns,
      missingArtifactBreakdown: clarifyMissingArtifactBreakdown,
      inspectionQueue: clarifyInspectionQueue,
      coverageBlindSpots: buildClarifyCoverageBlindSpots(clarifyCases, clarifyArtifactCoverage),
      promotionSignal: buildClarifyPromotionSignal(
        clarifyCases,
        clarifyAgentBreakdown,
        clarifyRepeatedTasks,
        clarifyRepeatedSources,
        clarifyRepeatedTargets,
        clarifyPressureTrajectories,
        clarifyRecurringReasons,
      ),
      cases: clarifyCases,
    },
    finalistSelectionPressure: {
      totalCases: finalistSelectionCases.length,
      finalistsWithoutRecommendationCases: finalistSelectionCases.filter(
        (item) => item.kind === "finalists-without-recommendation",
      ).length,
      judgeAbstainCases: finalistSelectionCases.filter((item) => item.kind === "judge-abstain")
        .length,
      manualCrowningCases: finalistSelectionCases.filter(
        (item) => item.kind === "manual-crowning-handoff",
      ).length,
      lowConfidenceRecommendationCases: finalistSelectionCases.filter(
        (item) => item.kind === "low-confidence-recommendation",
      ).length,
      artifactCoverage: finalistArtifactCoverage,
      metadataCoverage: finalistMetadataCoverage,
      recentCluster: finalistRecentCluster,
      agentBreakdown: finalistAgentBreakdown,
      repeatedTasks: finalistRepeatedTasks,
      repeatedSources: finalistRepeatedSources,
      repeatedTargets: finalistRepeatedTargets,
      repeatedStrategySets: finalistRepeatedStrategySets,
      repeatedJudgingCriteriaSets: finalistRepeatedJudgingCriteriaSets,
      pressureTrajectories: finalistPressureTrajectories,
      recurringReasons: finalistRecurringReasons,
      coverageGapRuns: finalistCoverageGapRuns,
      missingArtifactBreakdown: finalistMissingArtifactBreakdown,
      inspectionQueue: finalistInspectionQueue,
      coverageBlindSpots: buildFinalistCoverageBlindSpots(finalistSelectionCases),
      promotionSignal: buildFinalistPromotionSignal(
        finalistSelectionCases,
        finalistAgentBreakdown,
        finalistRepeatedTasks,
        finalistRepeatedSources,
        finalistRepeatedTargets,
        finalistRepeatedStrategySets,
        finalistRepeatedJudgingCriteriaSets,
        finalistPressureTrajectories,
        finalistRecurringReasons,
      ),
      cases: finalistSelectionCases,
    },
  });
}

export async function writeP3EvidenceReport(cwd: string): Promise<{
  path: string;
  projectRoot: string;
  report: P3EvidenceReport;
}> {
  const report = await collectP3Evidence(cwd);
  const path = getP3EvidencePath(report.projectRoot);
  await mkdir(getOraculumDir(report.projectRoot), { recursive: true });
  await writeJsonFile(path, report);
  return {
    path,
    projectRoot: report.projectRoot,
    report,
  };
}

export function renderP3EvidenceSummary(
  report: P3EvidenceReport,
  options?: { artifactPath?: string },
): string {
  const lines = [
    "P3 evidence summary:",
    `Project root: ${report.projectRoot}`,
    `Consultations scanned: ${report.consultationCount}`,
  ];

  if (options?.artifactPath) {
    lines.push(`Artifact: ${options.artifactPath}`);
  }

  lines.push(
    `Artifact coverage: preflight-readiness=${report.artifactCoverage.consultationsWithPreflightReadiness} preflight-fallback=${report.artifactCoverage.consultationsWithPreflightFallback} comparison=${report.artifactCoverage.consultationsWithComparisonReport} winner-selection=${report.artifactCoverage.consultationsWithWinnerSelection} failure-analysis=${report.artifactCoverage.consultationsWithFailureAnalysis} research-brief=${report.artifactCoverage.consultationsWithResearchBrief} manual-review=${report.artifactCoverage.consultationsWithManualReviewRecommendation}`,
  );
  lines.push(
    `Clarify pressure: total=${report.clarifyPressure.totalCases} needs-clarification=${report.clarifyPressure.needsClarificationCases} external-research-required=${report.clarifyPressure.externalResearchRequiredCases} repeated-tasks=${report.clarifyPressure.repeatedTasks.length} repeated-sources=${report.clarifyPressure.repeatedSources.length}`,
  );
  lines.push(
    `Clarify evidence coverage: targets=${report.clarifyPressure.artifactCoverage.casesWithTargetArtifact} preflight-readiness=${report.clarifyPressure.artifactCoverage.casesWithPreflightReadiness} preflight-fallback=${report.clarifyPressure.artifactCoverage.casesWithPreflightFallback} research-brief=${report.clarifyPressure.artifactCoverage.casesWithResearchBrief} manual-review=${report.clarifyPressure.artifactCoverage.casesWithManualReviewRecommendation}`,
  );
  lines.push(
    `Clarify metadata: validation-gaps=${report.clarifyPressure.metadataCoverage.consultationsWithValidationGaps} research-current=${report.clarifyPressure.metadataCoverage.consultationsWithCurrentResearchBasis} research-stale=${report.clarifyPressure.metadataCoverage.consultationsWithStaleResearchBasis} research-unknown=${report.clarifyPressure.metadataCoverage.consultationsWithUnknownResearchBasis} research-conflicts=${report.clarifyPressure.metadataCoverage.consultationsWithResearchConflicts} rerun=${report.clarifyPressure.metadataCoverage.consultationsWithResearchRerunRecommended}`,
  );
  if (report.clarifyPressure.missingArtifactBreakdown.length > 0) {
    lines.push(
      `Missing clarify artifacts: ${renderMissingArtifactBreakdown(report.clarifyPressure.missingArtifactBreakdown)}`,
    );
  }
  lines.push(
    `Clarify recent cluster: runs=${report.clarifyPressure.recentCluster.recentRunCount} window=${report.clarifyPressure.recentCluster.windowDays}d${report.clarifyPressure.recentCluster.latestRunId ? ` latest=${report.clarifyPressure.recentCluster.latestRunId}` : ""}`,
  );
  if (report.clarifyPressure.agentBreakdown.length > 0) {
    lines.push(`Clarify agents: ${renderAgentBreakdown(report.clarifyPressure.agentBreakdown)}`);
  }
  lines.push(
    `Clarify promotion signal: ${report.clarifyPressure.promotionSignal.shouldPromote ? "open-P3" : "hold"} (${report.clarifyPressure.promotionSignal.reasons.join("; ") || "no recurring clarify threshold met"})`,
  );
  lines.push(...renderBlindSpotPreview(report.clarifyPressure.coverageBlindSpots));
  lines.push(...renderInspectionQueue(report.clarifyPressure.inspectionQueue));
  lines.push(...renderCasePreview(report.clarifyPressure.cases));

  lines.push(
    `Finalist selection pressure: total=${report.finalistSelectionPressure.totalCases} finalists-without-recommendation=${report.finalistSelectionPressure.finalistsWithoutRecommendationCases} judge-abstain=${report.finalistSelectionPressure.judgeAbstainCases} manual-crowning=${report.finalistSelectionPressure.manualCrowningCases} low-confidence=${report.finalistSelectionPressure.lowConfidenceRecommendationCases} repeated-tasks=${report.finalistSelectionPressure.repeatedTasks.length} repeated-sources=${report.finalistSelectionPressure.repeatedSources.length}`,
  );
  lines.push(
    `Finalist evidence coverage: targets=${report.finalistSelectionPressure.artifactCoverage.casesWithTargetArtifact} comparison=${report.finalistSelectionPressure.artifactCoverage.casesWithComparisonReport} winner-selection=${report.finalistSelectionPressure.artifactCoverage.casesWithWinnerSelection} failure-analysis=${report.finalistSelectionPressure.artifactCoverage.casesWithFailureAnalysis} research-brief=${report.finalistSelectionPressure.artifactCoverage.casesWithResearchBrief} manual-review=${report.finalistSelectionPressure.artifactCoverage.casesWithManualReviewRecommendation}`,
  );
  lines.push(
    `Finalist metadata: validation-gaps=${report.finalistSelectionPressure.metadataCoverage.consultationsWithValidationGaps} research-current=${report.finalistSelectionPressure.metadataCoverage.consultationsWithCurrentResearchBasis} research-stale=${report.finalistSelectionPressure.metadataCoverage.consultationsWithStaleResearchBasis} research-unknown=${report.finalistSelectionPressure.metadataCoverage.consultationsWithUnknownResearchBasis} research-conflicts=${report.finalistSelectionPressure.metadataCoverage.consultationsWithResearchConflicts} rerun=${report.finalistSelectionPressure.metadataCoverage.consultationsWithResearchRerunRecommended} judging-criteria=${report.finalistSelectionPressure.metadataCoverage.consultationsWithJudgingCriteria}`,
  );
  if (report.finalistSelectionPressure.missingArtifactBreakdown.length > 0) {
    lines.push(
      `Missing finalist artifacts: ${renderMissingArtifactBreakdown(report.finalistSelectionPressure.missingArtifactBreakdown)}`,
    );
  }
  lines.push(
    `Finalist recent cluster: runs=${report.finalistSelectionPressure.recentCluster.recentRunCount} window=${report.finalistSelectionPressure.recentCluster.windowDays}d${report.finalistSelectionPressure.recentCluster.latestRunId ? ` latest=${report.finalistSelectionPressure.recentCluster.latestRunId}` : ""}`,
  );
  if (report.finalistSelectionPressure.agentBreakdown.length > 0) {
    lines.push(
      `Finalist agents: ${renderAgentBreakdown(report.finalistSelectionPressure.agentBreakdown)}`,
    );
  }
  lines.push(
    `Finalist promotion signal: ${report.finalistSelectionPressure.promotionSignal.shouldPromote ? "open-P3" : "hold"} (${report.finalistSelectionPressure.promotionSignal.reasons.join("; ") || "no recurring finalist-selection threshold met"})`,
  );
  lines.push(...renderBlindSpotPreview(report.finalistSelectionPressure.coverageBlindSpots));
  lines.push(...renderInspectionQueue(report.finalistSelectionPressure.inspectionQueue));
  lines.push(...renderCasePreview(report.finalistSelectionPressure.cases));

  if (
    report.clarifyPressure.repeatedTasks.length > 0 ||
    report.finalistSelectionPressure.repeatedTasks.length > 0
  ) {
    lines.push("Repeated tasks:");
    for (const item of [
      ...report.clarifyPressure.repeatedTasks,
      ...report.finalistSelectionPressure.repeatedTasks,
    ].slice(0, 6)) {
      lines.push(
        `- ${item.taskTitle}${item.targetArtifactPath ? ` (${item.targetArtifactPath})` : ""}: ${item.occurrenceCount} cases [${item.kinds.join(", ")}]`,
      );
    }
  }

  if (
    report.clarifyPressure.repeatedSources.length > 0 ||
    report.finalistSelectionPressure.repeatedSources.length > 0
  ) {
    lines.push("Repeated task sources:");
    for (const item of [
      ...report.clarifyPressure.repeatedSources,
      ...report.finalistSelectionPressure.repeatedSources,
    ].slice(0, 6)) {
      lines.push(
        `- ${item.taskSourcePath}: ${item.occurrenceCount} cases [${item.kinds.join(", ")}]`,
      );
    }
  }

  if (report.finalistSelectionPressure.repeatedStrategySets.length > 0) {
    lines.push("Repeated finalist strategy sets:");
    for (const item of report.finalistSelectionPressure.repeatedStrategySets.slice(0, 6)) {
      lines.push(
        `- ${item.strategyLabels.join(" + ")}: ${item.occurrenceCount} consultations [${item.kinds.join(", ")}]`,
      );
    }
  }

  if (report.finalistSelectionPressure.repeatedJudgingCriteriaSets.length > 0) {
    lines.push("Repeated judging criteria sets:");
    for (const item of report.finalistSelectionPressure.repeatedJudgingCriteriaSets.slice(0, 6)) {
      lines.push(
        `- ${item.judgingCriteria.join(" + ")}: ${item.occurrenceCount} consultations [${item.kinds.join(", ")}]`,
      );
    }
  }

  if (
    report.clarifyPressure.pressureTrajectories.length > 0 ||
    report.finalistSelectionPressure.pressureTrajectories.length > 0
  ) {
    lines.push("Pressure trajectories:");
    for (const item of [
      ...report.clarifyPressure.pressureTrajectories,
      ...report.finalistSelectionPressure.pressureTrajectories,
    ].slice(0, 6)) {
      lines.push(
        `- ${item.keyType} ${item.key} | agents=${item.agents.join(", ")} | span=${item.daySpanDays}d | escalation=${item.containsEscalation ? "yes" : "no"} | ${item.runs
          .map((run) => `${run.runId}[${run.kinds.join("+")}]`)
          .join(" -> ")}`,
      );
    }
  }

  return `${lines.join("\n")}\n`;
}

function limitEvidence(evidence: string[]): string[] {
  return evidence.slice(0, 3);
}

function renderCasePreview(cases: z.infer<typeof p3EvidenceCaseSchema>[]): string[] {
  if (cases.length === 0) {
    return ["- none"];
  }

  return cases.slice(0, 5).map((item) => {
    const suffix = item.question ?? item.summary;
    const artifactHint =
      item.artifactPaths.failureAnalysisPath ??
      item.artifactPaths.winnerSelectionPath ??
      item.artifactPaths.preflightReadinessPath;
    return `- ${item.runId} | ${item.kind} | ${item.taskTitle} | ${suffix}${artifactHint ? ` | inspect: ${artifactHint}` : ""}`;
  });
}

function renderBlindSpotPreview(items: string[]): string[] {
  return items.map((item) => `- blind spot: ${item}`);
}

function renderInspectionQueue(items: z.infer<typeof p3InspectionItemSchema>[]): string[] {
  return items.slice(0, 5).map((item) => `- inspect next: ${item.path} (${item.reason})`);
}

function renderAgentBreakdown(items: z.infer<typeof p3AgentBreakdownSchema>[]): string {
  return items
    .map((item) => `${item.agent}=cases:${item.caseCount},consultations:${item.consultationCount}`)
    .join(" ");
}

function renderMissingArtifactBreakdown(
  items: z.infer<typeof p3MissingArtifactBreakdownSchema>[],
): string {
  return items.map((item) => `${item.artifactKind}=${item.consultationCount}`).join(" ");
}

function buildRepeatedTasks(
  cases: z.infer<typeof p3EvidenceCaseSchema>[],
): z.infer<typeof p3RepeatedTaskSchema>[] {
  const grouped = new Map<
    string,
    {
      taskTitle: string;
      targetArtifactPath?: string;
      latestRunId: string;
      latestOpenedAt: string;
      kinds: Set<z.infer<typeof p3EvidenceCaseKindSchema>>;
      runIds: Set<string>;
    }
  >();

  for (const item of cases) {
    const key = `${item.taskTitle}\u0000${item.targetArtifactPath ?? ""}`;
    const current = grouped.get(key);
    if (!current) {
      grouped.set(key, {
        taskTitle: item.taskTitle,
        ...(item.targetArtifactPath ? { targetArtifactPath: item.targetArtifactPath } : {}),
        latestRunId: item.runId,
        latestOpenedAt: item.openedAt,
        kinds: new Set([item.kind]),
        runIds: new Set([item.runId]),
      });
      continue;
    }

    current.kinds.add(item.kind);
    current.runIds.add(item.runId);
    if (new Date(item.openedAt).getTime() > new Date(current.latestOpenedAt).getTime()) {
      current.latestOpenedAt = item.openedAt;
      current.latestRunId = item.runId;
    }
  }

  return [...grouped.values()]
    .filter((item) => item.runIds.size >= 2)
    .sort((left, right) => {
      if (right.runIds.size !== left.runIds.size) {
        return right.runIds.size - left.runIds.size;
      }
      return new Date(right.latestOpenedAt).getTime() - new Date(left.latestOpenedAt).getTime();
    })
    .map((item) =>
      p3RepeatedTaskSchema.parse({
        taskTitle: item.taskTitle,
        ...(item.targetArtifactPath ? { targetArtifactPath: item.targetArtifactPath } : {}),
        occurrenceCount: item.runIds.size,
        latestRunId: item.latestRunId,
        latestOpenedAt: item.latestOpenedAt,
        kinds: [...item.kinds].sort((left, right) => left.localeCompare(right)),
      }),
    );
}

function buildRepeatedTargets(
  cases: z.infer<typeof p3EvidenceCaseSchema>[],
): z.infer<typeof p3RepeatedTargetSchema>[] {
  const grouped = new Map<
    string,
    {
      latestRunId: string;
      latestOpenedAt: string;
      taskTitles: Set<string>;
      kinds: Set<z.infer<typeof p3EvidenceCaseKindSchema>>;
      runIds: Set<string>;
    }
  >();

  for (const item of cases) {
    if (!item.targetArtifactPath) {
      continue;
    }

    const current = grouped.get(item.targetArtifactPath);
    if (!current) {
      grouped.set(item.targetArtifactPath, {
        latestRunId: item.runId,
        latestOpenedAt: item.openedAt,
        taskTitles: new Set([item.taskTitle]),
        kinds: new Set([item.kind]),
        runIds: new Set([item.runId]),
      });
      continue;
    }

    current.taskTitles.add(item.taskTitle);
    current.kinds.add(item.kind);
    current.runIds.add(item.runId);
    if (new Date(item.openedAt).getTime() > new Date(current.latestOpenedAt).getTime()) {
      current.latestOpenedAt = item.openedAt;
      current.latestRunId = item.runId;
    }
  }

  return [...grouped.entries()]
    .filter(([, item]) => item.runIds.size >= 2)
    .sort((left, right) => {
      if (right[1].runIds.size !== left[1].runIds.size) {
        return right[1].runIds.size - left[1].runIds.size;
      }
      return (
        new Date(right[1].latestOpenedAt).getTime() - new Date(left[1].latestOpenedAt).getTime()
      );
    })
    .map(([targetArtifactPath, item]) =>
      p3RepeatedTargetSchema.parse({
        targetArtifactPath,
        occurrenceCount: item.runIds.size,
        latestRunId: item.latestRunId,
        latestOpenedAt: item.latestOpenedAt,
        taskTitles: [...item.taskTitles].sort((left, right) => left.localeCompare(right)),
        kinds: [...item.kinds].sort((left, right) => left.localeCompare(right)),
      }),
    );
}

function buildRepeatedSources(
  cases: z.infer<typeof p3EvidenceCaseSchema>[],
): z.infer<typeof p3RepeatedSourceSchema>[] {
  const grouped = new Map<
    string,
    {
      taskSourceKind: z.infer<typeof taskSourceKindSchema>;
      taskSourcePath: string;
      latestRunId: string;
      latestOpenedAt: string;
      taskTitles: Set<string>;
      kinds: Set<z.infer<typeof p3EvidenceCaseKindSchema>>;
      runIds: Set<string>;
    }
  >();

  for (const item of cases) {
    const key = `${item.taskSourceKind}\u0000${item.taskSourcePath}`;
    const current = grouped.get(key);
    if (!current) {
      grouped.set(key, {
        taskSourceKind: item.taskSourceKind,
        taskSourcePath: item.taskSourcePath,
        latestRunId: item.runId,
        latestOpenedAt: item.openedAt,
        taskTitles: new Set([item.taskTitle]),
        kinds: new Set([item.kind]),
        runIds: new Set([item.runId]),
      });
      continue;
    }

    current.taskTitles.add(item.taskTitle);
    current.kinds.add(item.kind);
    current.runIds.add(item.runId);
    if (new Date(item.openedAt).getTime() > new Date(current.latestOpenedAt).getTime()) {
      current.latestOpenedAt = item.openedAt;
      current.latestRunId = item.runId;
    }
  }

  return [...grouped.values()]
    .filter((item) => item.runIds.size >= 2)
    .sort((left, right) => {
      if (right.runIds.size !== left.runIds.size) {
        return right.runIds.size - left.runIds.size;
      }
      return new Date(right.latestOpenedAt).getTime() - new Date(left.latestOpenedAt).getTime();
    })
    .map((item) =>
      p3RepeatedSourceSchema.parse({
        taskSourceKind: item.taskSourceKind,
        taskSourcePath: item.taskSourcePath,
        occurrenceCount: item.runIds.size,
        latestRunId: item.latestRunId,
        latestOpenedAt: item.latestOpenedAt,
        taskTitles: [...item.taskTitles].sort((left, right) => left.localeCompare(right)),
        kinds: [...item.kinds].sort((left, right) => left.localeCompare(right)),
      }),
    );
}

function buildRecurringReasons(
  cases: z.infer<typeof p3EvidenceCaseSchema>[],
  getLabel: (item: z.infer<typeof p3EvidenceCaseSchema>) => string,
): z.infer<typeof p3RecurringReasonSchema>[] {
  const grouped = new Map<
    string,
    {
      latestRunId: string;
      latestOpenedAt: string;
      kinds: Set<z.infer<typeof p3EvidenceCaseKindSchema>>;
      runIds: Set<string>;
    }
  >();

  for (const item of cases) {
    const label = getLabel(item).trim();
    if (label.length === 0) {
      continue;
    }

    const current = grouped.get(label);
    if (!current) {
      grouped.set(label, {
        latestRunId: item.runId,
        latestOpenedAt: item.openedAt,
        kinds: new Set([item.kind]),
        runIds: new Set([item.runId]),
      });
      continue;
    }

    current.kinds.add(item.kind);
    current.runIds.add(item.runId);
    if (new Date(item.openedAt).getTime() > new Date(current.latestOpenedAt).getTime()) {
      current.latestOpenedAt = item.openedAt;
      current.latestRunId = item.runId;
    }
  }

  return [...grouped.entries()]
    .filter(([, item]) => item.runIds.size >= 2)
    .sort((left, right) => {
      if (right[1].runIds.size !== left[1].runIds.size) {
        return right[1].runIds.size - left[1].runIds.size;
      }
      return (
        new Date(right[1].latestOpenedAt).getTime() - new Date(left[1].latestOpenedAt).getTime()
      );
    })
    .map(([label, item]) =>
      p3RecurringReasonSchema.parse({
        label,
        occurrenceCount: item.runIds.size,
        latestRunId: item.latestRunId,
        latestOpenedAt: item.latestOpenedAt,
        kinds: [...item.kinds].sort((left, right) => left.localeCompare(right)),
      }),
    );
}

function buildAgentBreakdown(
  cases: z.infer<typeof p3EvidenceCaseSchema>[],
): z.infer<typeof p3AgentBreakdownSchema>[] {
  const grouped = new Map<
    z.infer<typeof adapterSchema>,
    {
      caseCount: number;
      runIds: Set<string>;
    }
  >();

  for (const item of cases) {
    const current = grouped.get(item.agent);
    if (!current) {
      grouped.set(item.agent, {
        caseCount: 1,
        runIds: new Set([item.runId]),
      });
      continue;
    }

    current.caseCount += 1;
    current.runIds.add(item.runId);
  }

  return [...grouped.entries()]
    .sort((left, right) => {
      if (right[1].caseCount !== left[1].caseCount) {
        return right[1].caseCount - left[1].caseCount;
      }
      return left[0].localeCompare(right[0]);
    })
    .map(([agent, item]) =>
      p3AgentBreakdownSchema.parse({
        agent,
        caseCount: item.caseCount,
        consultationCount: item.runIds.size,
      }),
    );
}

function buildPressureTrajectories(
  cases: z.infer<typeof p3EvidenceCaseSchema>[],
): z.infer<typeof p3PressureTrajectorySchema>[] {
  const grouped = new Map<
    string,
    {
      keyType: "target-artifact" | "task-source";
      key: string;
      latestRunId: string;
      latestOpenedAt: string;
      agents: Set<z.infer<typeof adapterSchema>>;
      distinctKinds: Set<z.infer<typeof p3EvidenceCaseKindSchema>>;
      runs: Map<
        string,
        {
          runId: string;
          openedAt: string;
          agent: z.infer<typeof adapterSchema>;
          taskTitle: string;
          kinds: Set<z.infer<typeof p3EvidenceCaseKindSchema>>;
        }
      >;
    }
  >();

  for (const item of cases) {
    const keyType = item.targetArtifactPath ? "target-artifact" : "task-source";
    const key = item.targetArtifactPath ?? item.taskSourcePath;
    const groupKey = `${keyType}\u0000${key}`;
    const current = grouped.get(groupKey);
    if (!current) {
      grouped.set(groupKey, {
        keyType,
        key,
        latestRunId: item.runId,
        latestOpenedAt: item.openedAt,
        agents: new Set([item.agent]),
        distinctKinds: new Set([item.kind]),
        runs: new Map([
          [
            item.runId,
            {
              runId: item.runId,
              openedAt: item.openedAt,
              agent: item.agent,
              taskTitle: item.taskTitle,
              kinds: new Set([item.kind]),
            },
          ],
        ]),
      });
      continue;
    }

    current.agents.add(item.agent);
    current.distinctKinds.add(item.kind);
    const run = current.runs.get(item.runId);
    if (!run) {
      current.runs.set(item.runId, {
        runId: item.runId,
        openedAt: item.openedAt,
        agent: item.agent,
        taskTitle: item.taskTitle,
        kinds: new Set([item.kind]),
      });
    } else {
      run.kinds.add(item.kind);
    }
    if (new Date(item.openedAt).getTime() > new Date(current.latestOpenedAt).getTime()) {
      current.latestOpenedAt = item.openedAt;
      current.latestRunId = item.runId;
    }
  }

  return [...grouped.values()]
    .filter(
      (item) => item.runs.size >= 2 && (item.distinctKinds.size >= 2 || item.agents.size >= 2),
    )
    .sort((left, right) => {
      if (right.runs.size !== left.runs.size) {
        return right.runs.size - left.runs.size;
      }
      return new Date(right.latestOpenedAt).getTime() - new Date(left.latestOpenedAt).getTime();
    })
    .map((item) => {
      const runs = [...item.runs.values()]
        .sort(
          (left, right) => new Date(left.openedAt).getTime() - new Date(right.openedAt).getTime(),
        )
        .map((run) =>
          p3PressureTrajectoryRunSchema.parse({
            runId: run.runId,
            openedAt: run.openedAt,
            agent: run.agent,
            taskTitle: run.taskTitle,
            kinds: [...run.kinds].sort((left, right) => left.localeCompare(right)),
          }),
        );
      return p3PressureTrajectorySchema.parse({
        keyType: item.keyType,
        key: item.key,
        occurrenceCount: item.runs.size,
        latestRunId: item.latestRunId,
        latestOpenedAt: item.latestOpenedAt,
        daySpanDays: calculateDaySpanDays(runs.map((run) => run.openedAt)),
        agents: [...item.agents].sort((left, right) => left.localeCompare(right)),
        distinctKinds: [...item.distinctKinds].sort((left, right) => left.localeCompare(right)),
        containsEscalation: detectTrajectoryEscalation(runs),
        runs,
      });
    });
}

function buildRepeatedStrategySets(
  cases: z.infer<typeof p3EvidenceCaseSchema>[],
): z.infer<typeof p3RepeatedStrategySetSchema>[] {
  const grouped = new Map<
    string,
    {
      strategyLabels: string[];
      latestRunId: string;
      latestOpenedAt: string;
      taskTitles: Set<string>;
      kinds: Set<z.infer<typeof p3EvidenceCaseKindSchema>>;
      runIds: Set<string>;
    }
  >();

  for (const item of cases) {
    const strategyLabels = [...new Set(item.candidateStrategyLabels)].sort((left, right) =>
      left.localeCompare(right),
    );
    if (strategyLabels.length === 0) {
      continue;
    }

    const key = strategyLabels.join("\u0000");
    const current = grouped.get(key);
    if (!current) {
      grouped.set(key, {
        strategyLabels,
        latestRunId: item.runId,
        latestOpenedAt: item.openedAt,
        taskTitles: new Set([item.taskTitle]),
        kinds: new Set([item.kind]),
        runIds: new Set([item.runId]),
      });
      continue;
    }

    current.taskTitles.add(item.taskTitle);
    current.kinds.add(item.kind);
    current.runIds.add(item.runId);
    if (new Date(item.openedAt).getTime() > new Date(current.latestOpenedAt).getTime()) {
      current.latestOpenedAt = item.openedAt;
      current.latestRunId = item.runId;
    }
  }

  return [...grouped.values()]
    .filter((item) => item.runIds.size >= 2)
    .sort((left, right) => {
      if (right.runIds.size !== left.runIds.size) {
        return right.runIds.size - left.runIds.size;
      }
      return new Date(right.latestOpenedAt).getTime() - new Date(left.latestOpenedAt).getTime();
    })
    .map((item) =>
      p3RepeatedStrategySetSchema.parse({
        strategyLabels: item.strategyLabels,
        occurrenceCount: item.runIds.size,
        latestRunId: item.latestRunId,
        latestOpenedAt: item.latestOpenedAt,
        taskTitles: [...item.taskTitles].sort((left, right) => left.localeCompare(right)),
        kinds: [...item.kinds].sort((left, right) => left.localeCompare(right)),
      }),
    );
}

function buildRepeatedJudgingCriteriaSets(
  cases: z.infer<typeof p3EvidenceCaseSchema>[],
): z.infer<typeof p3RepeatedJudgingCriteriaSetSchema>[] {
  const grouped = new Map<
    string,
    {
      judgingCriteria: string[];
      latestRunId: string;
      latestOpenedAt: string;
      taskTitles: Set<string>;
      kinds: Set<z.infer<typeof p3EvidenceCaseKindSchema>>;
      runIds: Set<string>;
    }
  >();

  for (const item of cases) {
    const judgingCriteria = [...new Set(item.judgingCriteria ?? [])].sort((left, right) =>
      left.localeCompare(right),
    );
    if (judgingCriteria.length === 0) {
      continue;
    }

    const key = judgingCriteria.join("\u0000");
    const current = grouped.get(key);
    if (!current) {
      grouped.set(key, {
        judgingCriteria,
        latestRunId: item.runId,
        latestOpenedAt: item.openedAt,
        taskTitles: new Set([item.taskTitle]),
        kinds: new Set([item.kind]),
        runIds: new Set([item.runId]),
      });
      continue;
    }

    current.taskTitles.add(item.taskTitle);
    current.kinds.add(item.kind);
    current.runIds.add(item.runId);
    if (new Date(item.openedAt).getTime() > new Date(current.latestOpenedAt).getTime()) {
      current.latestOpenedAt = item.openedAt;
      current.latestRunId = item.runId;
    }
  }

  return [...grouped.values()]
    .filter((item) => item.runIds.size >= 2)
    .sort((left, right) => {
      if (right.runIds.size !== left.runIds.size) {
        return right.runIds.size - left.runIds.size;
      }
      return new Date(right.latestOpenedAt).getTime() - new Date(left.latestOpenedAt).getTime();
    })
    .map((item) =>
      p3RepeatedJudgingCriteriaSetSchema.parse({
        judgingCriteria: item.judgingCriteria,
        occurrenceCount: item.runIds.size,
        latestRunId: item.latestRunId,
        latestOpenedAt: item.latestOpenedAt,
        taskTitles: [...item.taskTitles].sort((left, right) => left.localeCompare(right)),
        kinds: [...item.kinds].sort((left, right) => left.localeCompare(right)),
      }),
    );
}

function buildClarifyPromotionSignal(
  cases: z.infer<typeof p3EvidenceCaseSchema>[],
  _agentBreakdown: z.infer<typeof p3AgentBreakdownSchema>[],
  repeatedTasks: z.infer<typeof p3RepeatedTaskSchema>[],
  repeatedSources: z.infer<typeof p3RepeatedSourceSchema>[],
  repeatedTargets: z.infer<typeof p3RepeatedTargetSchema>[],
  pressureTrajectories: z.infer<typeof p3PressureTrajectorySchema>[],
  recurringReasons: z.infer<typeof p3RecurringReasonSchema>[],
): z.infer<typeof p3PromotionSignalSchema> {
  const distinctRunCount = new Set(cases.map((item) => item.runId)).size;
  const reasons: string[] = [];

  if (distinctRunCount >= 3) {
    reasons.push(`${distinctRunCount} consultations ended in clarify pressure.`);
  }
  if (repeatedTasks.some((item) => item.occurrenceCount >= 3)) {
    reasons.push(
      "The same task required clarification or external research in at least 3 consultations.",
    );
  }
  if (repeatedTargets.some((item) => item.occurrenceCount >= 2)) {
    reasons.push(
      "The same target artifact accumulated repeated clarify pressure across consultations.",
    );
  }
  if (repeatedSources.some((item) => item.occurrenceCount >= 2)) {
    reasons.push(
      "The same task source accumulated repeated clarify pressure across consultations.",
    );
  }
  const recentCluster = buildRecentCluster(cases);
  if (recentCluster.recentRunCount >= 3) {
    reasons.push(
      `${recentCluster.recentRunCount} clarify-pressure consultations landed within the recent ${recentCluster.windowDays}-day cluster.`,
    );
  }
  if (pressureTrajectories.some((item) => item.distinctKinds.length >= 2)) {
    reasons.push("The same clarify scope moved across multiple pressure kinds.");
  }
  if (pressureTrajectories.some((item) => item.agents.length >= 2)) {
    reasons.push("The same clarify pressure trajectory crossed multiple hosts.");
  }
  if (pressureTrajectories.some((item) => item.containsEscalation)) {
    reasons.push("At least one clarify trajectory escalated into a stronger blocker.");
  }
  if (recurringReasons.some((item) => item.occurrenceCount >= 2)) {
    reasons.push(
      "The same clarification or research blocker repeated across multiple consultations.",
    );
  }

  return p3PromotionSignalSchema.parse({
    shouldPromote: reasons.length > 0,
    distinctRunCount,
    reasons,
  });
}

function buildFinalistPromotionSignal(
  cases: z.infer<typeof p3EvidenceCaseSchema>[],
  _agentBreakdown: z.infer<typeof p3AgentBreakdownSchema>[],
  repeatedTasks: z.infer<typeof p3RepeatedTaskSchema>[],
  repeatedSources: z.infer<typeof p3RepeatedSourceSchema>[],
  repeatedTargets: z.infer<typeof p3RepeatedTargetSchema>[],
  repeatedStrategySets: z.infer<typeof p3RepeatedStrategySetSchema>[],
  repeatedJudgingCriteriaSets: z.infer<typeof p3RepeatedJudgingCriteriaSetSchema>[],
  pressureTrajectories: z.infer<typeof p3PressureTrajectorySchema>[],
  recurringReasons: z.infer<typeof p3RecurringReasonSchema>[],
): z.infer<typeof p3PromotionSignalSchema> {
  const distinctRunCount = new Set(cases.map((item) => item.runId)).size;
  const judgeAbstainCases = cases.filter((item) => item.kind === "judge-abstain").length;
  const manualCrowningCases = cases.filter(
    (item) => item.kind === "manual-crowning-handoff",
  ).length;
  const lowConfidenceCases = cases.filter(
    (item) => item.kind === "low-confidence-recommendation",
  ).length;
  const reasons: string[] = [];

  if (judgeAbstainCases >= 2) {
    reasons.push(`${judgeAbstainCases} consultations recorded judge abstain outcomes.`);
  }
  if (manualCrowningCases >= 2) {
    reasons.push(`${manualCrowningCases} consultations required manual crowning handoff.`);
  }
  if (lowConfidenceCases >= 2) {
    reasons.push(`${lowConfidenceCases} consultations selected low-confidence winners.`);
  }
  if (repeatedTasks.some((item) => item.occurrenceCount >= 2) && cases.length >= 3) {
    reasons.push(
      "The same task accumulated repeated finalist-selection pressure across consultations.",
    );
  }
  if (repeatedTargets.some((item) => item.occurrenceCount >= 2)) {
    reasons.push(
      "The same target artifact accumulated repeated finalist-selection pressure across consultations.",
    );
  }
  if (repeatedSources.some((item) => item.occurrenceCount >= 2)) {
    reasons.push(
      "The same task source accumulated repeated finalist-selection pressure across consultations.",
    );
  }
  if (repeatedStrategySets.some((item) => item.occurrenceCount >= 2)) {
    reasons.push(
      "The same finalist strategy mix accumulated repeated finalist-selection pressure across consultations.",
    );
  }
  if (repeatedJudgingCriteriaSets.some((item) => item.occurrenceCount >= 2)) {
    reasons.push(
      "The same judging-criteria set accumulated repeated finalist-selection pressure across consultations.",
    );
  }
  const recentCluster = buildRecentCluster(cases);
  if (recentCluster.recentRunCount >= 2 && cases.length >= 3) {
    reasons.push(
      `${recentCluster.recentRunCount} finalist-pressure consultations landed within the recent ${recentCluster.windowDays}-day cluster.`,
    );
  }
  if (pressureTrajectories.some((item) => item.agents.length >= 2)) {
    reasons.push("The same finalist-selection pressure trajectory crossed multiple hosts.");
  }
  if (pressureTrajectories.some((item) => item.containsEscalation)) {
    reasons.push("At least one finalist-selection trajectory escalated into a stronger blocker.");
  }
  if (recurringReasons.some((item) => item.occurrenceCount >= 2)) {
    reasons.push("The same finalist-selection blocker repeated across multiple consultations.");
  }

  return p3PromotionSignalSchema.parse({
    shouldPromote: reasons.length > 0,
    distinctRunCount,
    reasons,
  });
}

function buildPressureMetadataCoverage(
  cases: z.infer<typeof p3EvidenceCaseSchema>[],
): z.infer<typeof p3PressureMetadataCoverageSchema> {
  const grouped = new Map<
    string,
    {
      validationGaps: boolean;
      researchCurrent: boolean;
      researchStale: boolean;
      researchUnknown: boolean;
      researchConflicts: boolean;
      researchRerunRecommended: boolean;
      judgingCriteria: boolean;
    }
  >();

  for (const item of cases) {
    const current = grouped.get(item.runId) ?? {
      validationGaps: false,
      researchCurrent: false,
      researchStale: false,
      researchUnknown: false,
      researchConflicts: false,
      researchRerunRecommended: false,
      judgingCriteria: false,
    };
    current.validationGaps ||= item.validationPosture === "validation-gaps";
    current.researchCurrent ||= item.researchBasisStatus === "current";
    current.researchStale ||= item.researchBasisStatus === "stale";
    current.researchUnknown ||= item.researchBasisStatus === "unknown";
    current.researchConflicts ||= item.researchConflictHandling === "manual-review-required";
    current.researchRerunRecommended ||= item.researchRerunRecommended;
    current.judgingCriteria ||= Boolean(item.judgingCriteria?.length);
    grouped.set(item.runId, current);
  }

  const values = [...grouped.values()];
  return p3PressureMetadataCoverageSchema.parse({
    consultationCount: grouped.size,
    consultationsWithValidationGaps: values.filter((item) => item.validationGaps).length,
    consultationsWithCurrentResearchBasis: values.filter((item) => item.researchCurrent).length,
    consultationsWithStaleResearchBasis: values.filter((item) => item.researchStale).length,
    consultationsWithUnknownResearchBasis: values.filter((item) => item.researchUnknown).length,
    consultationsWithResearchConflicts: values.filter((item) => item.researchConflicts).length,
    consultationsWithResearchRerunRecommended: values.filter(
      (item) => item.researchRerunRecommended,
    ).length,
    consultationsWithJudgingCriteria: values.filter((item) => item.judgingCriteria).length,
  });
}

function buildPressureArtifactCoverage(
  cases: z.infer<typeof p3EvidenceCaseSchema>[],
): z.infer<typeof p3PressureArtifactCoverageSchema> {
  return p3PressureArtifactCoverageSchema.parse({
    caseCount: cases.length,
    casesWithTargetArtifact: cases.filter((item) => item.targetArtifactPath).length,
    casesWithPreflightReadiness: cases.filter((item) => item.artifactPaths.preflightReadinessPath)
      .length,
    casesWithPreflightFallback: cases.filter((item) => item.preflightFallbackObserved).length,
    casesWithComparisonReport: cases.filter(
      (item) => item.artifactPaths.comparisonJsonPath || item.artifactPaths.comparisonMarkdownPath,
    ).length,
    casesWithWinnerSelection: cases.filter((item) => item.artifactPaths.winnerSelectionPath).length,
    casesWithFailureAnalysis: cases.filter((item) => item.artifactPaths.failureAnalysisPath).length,
    casesWithResearchBrief: cases.filter((item) => item.artifactPaths.researchBriefPath).length,
    casesWithManualReviewRecommendation: cases.filter((item) => item.manualReviewRecommended)
      .length,
  });
}

function buildClarifyCoverageBlindSpots(
  cases: z.infer<typeof p3EvidenceCaseSchema>[],
  artifactCoverage: z.infer<typeof p3PressureArtifactCoverageSchema>,
): string[] {
  const blindSpots: string[] = [];

  if (
    artifactCoverage.caseCount > 0 &&
    artifactCoverage.casesWithPreflightReadiness < cases.length
  ) {
    blindSpots.push("Some clarify cases are missing preflight-readiness artifacts.");
  }
  const structuredPreflightCases =
    artifactCoverage.casesWithPreflightReadiness - artifactCoverage.casesWithPreflightFallback;
  if (
    artifactCoverage.caseCount > 0 &&
    artifactCoverage.casesWithPreflightFallback > structuredPreflightCases
  ) {
    blindSpots.push(
      "Clarify evidence is dominated by fallback preflight results instead of structured runtime recommendations.",
    );
  }
  if (
    cases.some((item) => item.kind === "external-research-required") &&
    cases.some(
      (item) => item.kind === "external-research-required" && !item.artifactPaths.researchBriefPath,
    )
  ) {
    blindSpots.push("External-research blockers have no persisted research-brief artifacts yet.");
  }

  return blindSpots;
}

function buildFinalistCoverageBlindSpots(cases: z.infer<typeof p3EvidenceCaseSchema>[]): string[] {
  const blindSpots: string[] = [];

  if (
    cases.some(
      (item) =>
        item.kind === "finalists-without-recommendation" ||
        item.kind === "judge-abstain" ||
        item.kind === "low-confidence-recommendation",
    ) &&
    cases.some(
      (item) =>
        (item.kind === "finalists-without-recommendation" ||
          item.kind === "judge-abstain" ||
          item.kind === "low-confidence-recommendation") &&
        !item.artifactPaths.winnerSelectionPath,
    )
  ) {
    blindSpots.push(
      "Some finalist-selection pressure cases are missing winner-selection artifacts.",
    );
  }
  if (
    cases.some((item) => item.kind === "judge-abstain") &&
    cases.some((item) => item.kind === "judge-abstain" && !item.artifactPaths.failureAnalysisPath)
  ) {
    blindSpots.push(
      "Judge-abstain cases are present without persisted failure-analysis artifacts.",
    );
  }
  if (
    cases.some(
      (item) =>
        (item.kind === "finalists-without-recommendation" ||
          item.kind === "judge-abstain" ||
          item.kind === "low-confidence-recommendation") &&
        !item.artifactPaths.comparisonJsonPath &&
        !item.artifactPaths.comparisonMarkdownPath,
    )
  ) {
    blindSpots.push("Some finalist-selection pressure cases are missing comparison reports.");
  }
  if (
    cases.some((item) => item.kind === "manual-crowning-handoff") &&
    cases.some((item) => item.kind === "manual-crowning-handoff" && !item.manualReviewRecommended)
  ) {
    blindSpots.push(
      "Manual-crowning handoff cases are present without manual-review recommendations.",
    );
  }

  return blindSpots;
}

function buildClarifyInspectionQueue(
  projectRoot: string,
  cases: z.infer<typeof p3EvidenceCaseSchema>[],
  coverageGapRuns: z.infer<typeof p3CoverageGapRunSchema>[],
): z.infer<typeof p3InspectionItemSchema>[] {
  return [
    ...buildGapInspectionQueue(projectRoot, coverageGapRuns),
    ...buildInspectionQueue(cases, [
      {
        artifactKind: "research-brief",
        path: (item) => item.artifactPaths.researchBriefPath,
        reason: (item) =>
          item.kind === "external-research-required"
            ? "Review the bounded research artifact for this blocker."
            : undefined,
      },
      {
        artifactKind: "preflight-readiness",
        path: (item) => item.artifactPaths.preflightReadinessPath,
        reason: (item) =>
          item.preflightFallbackObserved
            ? "Inspect fallback preflight evidence and missing structured recommendation details."
            : "Inspect the structured preflight readiness artifact for this blocker.",
      },
    ]),
  ];
}

function buildFinalistInspectionQueue(
  projectRoot: string,
  cases: z.infer<typeof p3EvidenceCaseSchema>[],
  coverageGapRuns: z.infer<typeof p3CoverageGapRunSchema>[],
): z.infer<typeof p3InspectionItemSchema>[] {
  return [
    ...buildGapInspectionQueue(projectRoot, coverageGapRuns),
    ...buildInspectionQueue(cases, [
      {
        artifactKind: "failure-analysis",
        path: (item) => item.artifactPaths.failureAnalysisPath,
        reason: (item) =>
          item.kind === "judge-abstain" || item.kind === "finalists-without-recommendation"
            ? "Inspect why the finalists did not produce a safe recommendation."
            : undefined,
      },
      {
        artifactKind: "winner-selection",
        path: (item) => item.artifactPaths.winnerSelectionPath,
        reason: (item) =>
          item.kind === "judge-abstain" || item.kind === "low-confidence-recommendation"
            ? "Inspect the judge output and confidence rationale."
            : undefined,
      },
      {
        artifactKind: "comparison-json",
        path: (item) => item.artifactPaths.comparisonJsonPath,
        reason: () => "Inspect finalist evidence and outcome comparisons in machine-readable form.",
      },
      {
        artifactKind: "comparison-markdown",
        path: (item) => item.artifactPaths.comparisonMarkdownPath,
        reason: () => "Inspect the human-readable finalist comparison narrative.",
      },
    ]),
  ];
}

function buildGapInspectionQueue(
  projectRoot: string,
  gapRuns: z.infer<typeof p3CoverageGapRunSchema>[],
): z.infer<typeof p3InspectionItemSchema>[] {
  return [...gapRuns]
    .sort((left, right) => new Date(right.openedAt).getTime() - new Date(left.openedAt).getTime())
    .map((item) =>
      p3InspectionItemSchema.parse({
        artifactKind: "run-manifest",
        runId: item.runId,
        openedAt: item.openedAt,
        reason: `Inspect the run manifest because ${item.missingArtifactKinds.join(", ")} are missing for this pressure case.`,
        path: getRunManifestPath(projectRoot, item.runId),
      }),
    );
}

function buildInspectionQueue(
  cases: z.infer<typeof p3EvidenceCaseSchema>[],
  specs: Array<{
    artifactKind: z.infer<typeof p3InspectionItemSchema>["artifactKind"];
    path: (item: z.infer<typeof p3EvidenceCaseSchema>) => string | undefined;
    reason: (item: z.infer<typeof p3EvidenceCaseSchema>) => string | undefined;
  }>,
): z.infer<typeof p3InspectionItemSchema>[] {
  const items: z.infer<typeof p3InspectionItemSchema>[] = [];
  const seenPaths = new Set<string>();

  for (const item of [...cases].sort(
    (left, right) => new Date(right.openedAt).getTime() - new Date(left.openedAt).getTime(),
  )) {
    for (const spec of specs) {
      const path = spec.path(item);
      const reason = spec.reason(item);
      if (!path || !reason || seenPaths.has(path)) {
        continue;
      }

      seenPaths.add(path);
      items.push(
        p3InspectionItemSchema.parse({
          artifactKind: spec.artifactKind,
          runId: item.runId,
          openedAt: item.openedAt,
          reason,
          path,
        }),
      );
    }
  }

  return items;
}

function buildRecentCluster(
  cases: z.infer<typeof p3EvidenceCaseSchema>[],
  windowDays = 7,
): z.infer<typeof p3RecentClusterSchema> {
  if (cases.length === 0) {
    return p3RecentClusterSchema.parse({
      windowDays,
      recentRunCount: 0,
    });
  }

  const [latest] = [...cases].sort(
    (left, right) => new Date(right.openedAt).getTime() - new Date(left.openedAt).getTime(),
  );
  if (!latest) {
    return p3RecentClusterSchema.parse({
      windowDays,
      recentRunCount: 0,
    });
  }
  const latestTime = new Date(latest.openedAt).getTime();
  const windowMs = windowDays * 24 * 60 * 60 * 1000;
  const runIds = new Set(
    cases
      .filter((item) => latestTime - new Date(item.openedAt).getTime() <= windowMs)
      .map((item) => item.runId),
  );

  return p3RecentClusterSchema.parse({
    windowDays,
    recentRunCount: runIds.size,
    latestRunId: latest.runId,
    latestOpenedAt: latest.openedAt,
  });
}

function buildCoverageGapRuns(
  projectRoot: string,
  cases: z.infer<typeof p3EvidenceCaseSchema>[],
  getMissingArtifactKinds: (
    item: z.infer<typeof p3EvidenceCaseSchema>,
  ) => z.infer<typeof p3MissingArtifactKindSchema>[],
): z.infer<typeof p3CoverageGapRunSchema>[] {
  const grouped = new Map<
    string,
    {
      runId: string;
      openedAt: string;
      agent: z.infer<typeof adapterSchema>;
      taskTitle: string;
      taskSourceKind: z.infer<typeof taskSourceKindSchema>;
      taskSourcePath: string;
      targetArtifactPath?: string;
      consultationPath: string;
      kinds: Set<z.infer<typeof p3EvidenceCaseKindSchema>>;
      missingArtifactKinds: Set<z.infer<typeof p3MissingArtifactKindSchema>>;
    }
  >();

  for (const item of cases) {
    const missingArtifactKinds = getMissingArtifactKinds(item);
    if (missingArtifactKinds.length === 0) {
      continue;
    }

    const current = grouped.get(item.runId);
    if (!current) {
      grouped.set(item.runId, {
        runId: item.runId,
        openedAt: item.openedAt,
        agent: item.agent,
        taskTitle: item.taskTitle,
        taskSourceKind: item.taskSourceKind,
        taskSourcePath: item.taskSourcePath,
        ...(item.targetArtifactPath ? { targetArtifactPath: item.targetArtifactPath } : {}),
        consultationPath: item.consultationPath,
        kinds: new Set([item.kind]),
        missingArtifactKinds: new Set(missingArtifactKinds),
      });
      continue;
    }

    current.kinds.add(item.kind);
    for (const missingArtifactKind of missingArtifactKinds) {
      current.missingArtifactKinds.add(missingArtifactKind);
    }
  }

  return [...grouped.values()]
    .sort((left, right) => new Date(right.openedAt).getTime() - new Date(left.openedAt).getTime())
    .map((item) =>
      p3CoverageGapRunSchema.parse({
        runId: item.runId,
        openedAt: item.openedAt,
        agent: item.agent,
        taskTitle: item.taskTitle,
        taskSourceKind: item.taskSourceKind,
        taskSourcePath: item.taskSourcePath,
        ...(item.targetArtifactPath ? { targetArtifactPath: item.targetArtifactPath } : {}),
        consultationPath: item.consultationPath,
        manifestPath: getRunManifestPath(projectRoot, item.runId),
        kinds: [...item.kinds].sort((left, right) => left.localeCompare(right)),
        missingArtifactKinds: [...item.missingArtifactKinds].sort((left, right) =>
          left.localeCompare(right),
        ),
      }),
    );
}

function buildMissingArtifactBreakdown(
  gapRuns: z.infer<typeof p3CoverageGapRunSchema>[],
): z.infer<typeof p3MissingArtifactBreakdownSchema>[] {
  const grouped = new Map<z.infer<typeof p3MissingArtifactKindSchema>, Set<string>>();

  for (const item of gapRuns) {
    for (const missingArtifactKind of item.missingArtifactKinds) {
      const current = grouped.get(missingArtifactKind);
      if (!current) {
        grouped.set(missingArtifactKind, new Set([item.runId]));
        continue;
      }

      current.add(item.runId);
    }
  }

  return [...grouped.entries()]
    .sort((left, right) => {
      if (right[1].size !== left[1].size) {
        return right[1].size - left[1].size;
      }
      return left[0].localeCompare(right[0]);
    })
    .map(([artifactKind, runIds]) =>
      p3MissingArtifactBreakdownSchema.parse({
        artifactKind,
        consultationCount: runIds.size,
      }),
    );
}

function getClarifyMissingArtifacts(
  item: z.infer<typeof p3EvidenceCaseSchema>,
): z.infer<typeof p3MissingArtifactKindSchema>[] {
  const missingArtifacts: z.infer<typeof p3MissingArtifactKindSchema>[] = [];

  if (!item.artifactPaths.preflightReadinessPath) {
    missingArtifacts.push("preflight-readiness");
  }
  if (item.kind === "external-research-required" && !item.artifactPaths.researchBriefPath) {
    missingArtifacts.push("research-brief");
  }

  return missingArtifacts;
}

function getFinalistMissingArtifacts(
  item: z.infer<typeof p3EvidenceCaseSchema>,
): z.infer<typeof p3MissingArtifactKindSchema>[] {
  const missingArtifacts: z.infer<typeof p3MissingArtifactKindSchema>[] = [];
  const hasComparisonReport = Boolean(
    item.artifactPaths.comparisonJsonPath || item.artifactPaths.comparisonMarkdownPath,
  );

  if (
    (item.kind === "finalists-without-recommendation" ||
      item.kind === "judge-abstain" ||
      item.kind === "low-confidence-recommendation") &&
    !item.artifactPaths.winnerSelectionPath
  ) {
    missingArtifacts.push("winner-selection");
  }
  if (
    (item.kind === "finalists-without-recommendation" ||
      item.kind === "judge-abstain" ||
      item.kind === "manual-crowning-handoff" ||
      item.kind === "low-confidence-recommendation") &&
    !hasComparisonReport
  ) {
    missingArtifacts.push("comparison-report");
  }
  if (item.kind === "judge-abstain" && !item.artifactPaths.failureAnalysisPath) {
    missingArtifacts.push("failure-analysis");
  }

  return missingArtifacts;
}

function calculateDaySpanDays(openedAtValues: string[]): number {
  if (openedAtValues.length < 2) {
    return 0;
  }

  const sorted = [...openedAtValues].sort(
    (left, right) => new Date(left).getTime() - new Date(right).getTime(),
  );
  const [earliestValue] = sorted;
  const latestValue = sorted.at(-1);
  if (!earliestValue || !latestValue) {
    return 0;
  }
  const earliest = new Date(earliestValue).getTime();
  const latest = new Date(latestValue).getTime();
  return Math.max(0, Math.round((latest - earliest) / (24 * 60 * 60 * 1000)));
}

function detectTrajectoryEscalation(
  runs: z.infer<typeof p3PressureTrajectoryRunSchema>[],
): boolean {
  let previousSeverity = -1;

  for (const run of runs) {
    const currentSeverity = Math.max(...run.kinds.map(scoreEvidenceCaseKind));
    if (previousSeverity >= 0 && currentSeverity > previousSeverity) {
      return true;
    }
    previousSeverity = currentSeverity;
  }

  return false;
}

function scoreEvidenceCaseKind(kind: z.infer<typeof p3EvidenceCaseKindSchema>): number {
  switch (kind) {
    case "clarify-needed":
      return 1;
    case "external-research-required":
      return 2;
    case "low-confidence-recommendation":
      return 1;
    case "finalists-without-recommendation":
      return 2;
    case "manual-crowning-handoff":
      return 2;
    case "judge-abstain":
      return 3;
  }
}

const preflightReadinessArtifactSchema = z
  .object({
    llmSkipped: z.boolean().optional(),
    llmFailure: z.string().min(1).optional(),
  })
  .passthrough();

async function readPreflightReadiness(
  path: string | undefined,
): Promise<z.infer<typeof preflightReadinessArtifactSchema> | undefined> {
  if (!path) {
    return undefined;
  }

  try {
    return preflightReadinessArtifactSchema.parse(
      JSON.parse(await readFile(path, "utf8")) as unknown,
    );
  } catch {
    return undefined;
  }
}

async function resolveConsultationArtifacts(
  projectRoot: string,
  runId: string,
): Promise<{
  preflightReadinessPath?: string;
  researchBriefPath?: string;
  failureAnalysisPath?: string;
  profileSelectionPath?: string;
  comparisonJsonPath?: string;
  comparisonMarkdownPath?: string;
  winnerSelectionPath?: string;
  crowningRecordPath?: string;
}> {
  const [
    preflightReadinessPath,
    researchBriefPath,
    failureAnalysisPath,
    profileSelectionPath,
    comparisonJsonPath,
    comparisonMarkdownPath,
    winnerSelectionPath,
  ] = await Promise.all([
    existingPath(getPreflightReadinessPath(projectRoot, runId)),
    existingPath(getResearchBriefPath(projectRoot, runId)),
    existingPath(getFailureAnalysisPath(projectRoot, runId)),
    existingPath(getProfileSelectionPath(projectRoot, runId)),
    existingPath(getFinalistComparisonJsonPath(projectRoot, runId)),
    existingPath(getFinalistComparisonMarkdownPath(projectRoot, runId)),
    existingPath(getWinnerSelectionPath(projectRoot, runId)),
  ]);

  return {
    ...(preflightReadinessPath ? { preflightReadinessPath } : {}),
    ...(researchBriefPath ? { researchBriefPath } : {}),
    ...(failureAnalysisPath ? { failureAnalysisPath } : {}),
    ...(profileSelectionPath ? { profileSelectionPath } : {}),
    ...(comparisonJsonPath ? { comparisonJsonPath } : {}),
    ...(comparisonMarkdownPath ? { comparisonMarkdownPath } : {}),
    ...(winnerSelectionPath ? { winnerSelectionPath } : {}),
  };
}

async function existingPath(path: string): Promise<string | undefined> {
  return (await pathExists(path)) ? path : undefined;
}

async function readWinnerSelection(
  path: string | undefined,
): Promise<z.infer<typeof agentJudgeResultSchema> | undefined> {
  if (!path) {
    return undefined;
  }

  try {
    return agentJudgeResultSchema.parse(JSON.parse(await readFile(path, "utf8")) as unknown);
  } catch {
    return undefined;
  }
}

async function readFailureAnalysis(
  path: string | undefined,
): Promise<z.infer<typeof failureAnalysisSchema> | undefined> {
  if (!path) {
    return undefined;
  }

  try {
    return failureAnalysisSchema.parse(JSON.parse(await readFile(path, "utf8")) as unknown);
  } catch {
    return undefined;
  }
}

function resolveCandidateStrategyLabels(
  manifest: Awaited<ReturnType<typeof listRecentConsultations>>[number],
  candidateIds: string[],
): string[] {
  if (candidateIds.length === 0) {
    return [];
  }

  const labels = candidateIds
    .map(
      (candidateId) =>
        manifest.candidates.find((candidate) => candidate.id === candidateId)?.strategyLabel,
    )
    .filter((label): label is string => typeof label === "string" && label.length > 0);

  return [...new Set(labels)].sort((left, right) => left.localeCompare(right));
}
