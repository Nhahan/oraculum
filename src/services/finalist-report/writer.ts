import { writeFile } from "node:fs/promises";
import type { z } from "zod";

import type { AgentRunResult } from "../../adapters/types.js";
import {
  getFinalistComparisonJsonPath,
  getFinalistComparisonMarkdownPath,
  resolveProjectRoot,
} from "../../core/paths.js";
import type { Adapter, ManagedTreeRules } from "../../domain/config.js";
import type { OracleVerdict } from "../../domain/oracle.js";
import {
  type consultationProfileSelectionSchema,
  getValidationGaps,
  getValidationProfileId,
  getValidationSignals,
  getValidationSummary,
} from "../../domain/profile.js";
import type {
  CandidateManifest,
  consultationPreflightSchema,
  consultationVerificationLevelSchema,
  RunRecommendation,
} from "../../domain/run.js";
import {
  deriveResearchBasisStatus,
  deriveResearchConflictHandling,
  describeRecommendedTaskResultLabel,
  type TaskPacketSummary,
} from "../../domain/task.js";
import { buildEnrichedFinalistSummaries } from "../finalist-insights.js";
import { writeJsonFile } from "../project.js";

import { countVerdicts } from "./counts.js";
import { toDisplayPath } from "./display-path.js";
import { buildComparisonMarkdown } from "./markdown.js";
import { comparisonReportSchema } from "./schema.js";

interface WriteFinalistComparisonReportOptions {
  candidateResults: AgentRunResult[];
  candidates: CandidateManifest[];
  projectRoot: string;
  recommendedWinner?: RunRecommendation;
  runId: string;
  taskPacket: TaskPacketSummary;
  verdictsByCandidate: Map<string, OracleVerdict[]>;
  agent: Adapter;
  preflight?: z.infer<typeof consultationPreflightSchema>;
  consultationProfile?: z.infer<typeof consultationProfileSelectionSchema>;
  verificationLevel: z.infer<typeof consultationVerificationLevelSchema>;
  managedTreeRules?: ManagedTreeRules;
}

export async function writeFinalistComparisonReport(
  options: WriteFinalistComparisonReportOptions,
): Promise<{ jsonPath: string; markdownPath: string }> {
  const projectRoot = resolveProjectRoot(options.projectRoot);
  const displayTargetArtifactPath = options.taskPacket.targetArtifactPath
    ? toDisplayPath(projectRoot, options.taskPacket.targetArtifactPath)
    : undefined;
  const finalists = await buildEnrichedFinalistSummaries({
    candidates: options.candidates,
    candidateResults: options.candidateResults,
    ...(options.managedTreeRules ? { managedTreeRules: options.managedTreeRules } : {}),
    verdictsByCandidate: options.verdictsByCandidate,
  });
  const candidateById = new Map(options.candidates.map((candidate) => [candidate.id, candidate]));
  const researchRerunInputPath =
    options.taskPacket.sourceKind === "research-brief" ? options.taskPacket.sourcePath : undefined;
  const researchRerunRecommended = options.preflight?.researchBasisDrift === true;
  const report = comparisonReportSchema.parse({
    runId: options.runId,
    generatedAt: new Date().toISOString(),
    agent: options.agent,
    task: options.taskPacket,
    targetResultLabel: describeRecommendedTaskResultLabel({
      ...(options.taskPacket.artifactKind ? { artifactKind: options.taskPacket.artifactKind } : {}),
      ...(displayTargetArtifactPath ? { targetArtifactPath: displayTargetArtifactPath } : {}),
    }),
    finalistCount: finalists.length,
    ...(options.recommendedWinner ? { recommendedWinner: options.recommendedWinner } : {}),
    ...(options.recommendedWinner ? { whyThisWon: options.recommendedWinner.summary } : {}),
    ...(getValidationProfileId(options.consultationProfile)
      ? { validationProfileId: getValidationProfileId(options.consultationProfile) }
      : {}),
    ...(getValidationSummary(options.consultationProfile)
      ? { validationSummary: getValidationSummary(options.consultationProfile) }
      : {}),
    validationSignals: getValidationSignals(options.consultationProfile),
    validationGaps: getValidationGaps(options.consultationProfile),
    researchBasisStatus: deriveResearchBasisStatus({
      researchContext: options.taskPacket.researchContext,
      researchBasisDrift: options.preflight?.researchBasisDrift,
    }),
    ...(options.taskPacket.researchContext
      ? {
          researchConflictHandling:
            options.taskPacket.researchContext.conflictHandling ??
            deriveResearchConflictHandling(options.taskPacket.researchContext.unresolvedConflicts),
        }
      : {}),
    ...(options.preflight?.researchBasisDrift !== undefined
      ? { researchBasisDrift: options.preflight.researchBasisDrift }
      : {}),
    researchRerunRecommended,
    ...(researchRerunInputPath ? { researchRerunInputPath } : {}),
    ...(options.consultationProfile ? { consultationProfile: options.consultationProfile } : {}),
    verificationLevel: options.verificationLevel,
    finalists: finalists.map((finalist) => ({
      ...finalist,
      status: candidateById.get(finalist.candidateId)?.status ?? "planned",
      verdictCounts: countVerdicts(finalist.verdicts),
    })),
  });

  const jsonPath = getFinalistComparisonJsonPath(projectRoot, options.runId);
  const markdownPath = getFinalistComparisonMarkdownPath(projectRoot, options.runId);
  await writeJsonFile(jsonPath, report);
  await writeFile(markdownPath, buildComparisonMarkdown(report, projectRoot), "utf8");

  return { jsonPath, markdownPath };
}
