import type { RunManifest } from "../../../domain/run.js";
import {
  filterArtifactForConsultationRun,
  hasCurrentComparisonMarkdownArtifact,
  readClarifyFollowUpArtifact,
  readComparisonReportArtifact,
  readExportPlanArtifact,
  readFailureAnalysisArtifact,
  readPreflightReadinessArtifact,
  readProfileSelectionArtifact,
  readResearchBriefArtifact,
  readSecondOpinionWinnerSelectionArtifact,
  readWinnerSelectionArtifact,
} from "../../consultation-artifacts.js";
import type { LoadedVerdictReviewArtifacts, VerdictReviewArtifactPaths } from "./types.js";

export async function loadVerdictReviewArtifacts(
  manifest: RunManifest,
  artifacts: VerdictReviewArtifactPaths,
): Promise<LoadedVerdictReviewArtifacts> {
  const comparisonReport = await readComparisonReportArtifact(artifacts.comparisonJsonPath);
  const filteredComparisonReport = filterArtifactForConsultationRun(comparisonReport, {
    expectedRunId: manifest.id,
  });
  const comparisonMarkdownAvailable = artifacts.comparisonMarkdownPath
    ? await hasCurrentComparisonMarkdownArtifact(artifacts.comparisonMarkdownPath, manifest.id)
    : false;
  const preflightReadiness = filterArtifactForConsultationRun(
    await readPreflightReadinessArtifact(artifacts.preflightReadinessPath),
    { expectedRunId: manifest.id },
  );
  const winnerSelection = filterArtifactForConsultationRun(
    await readWinnerSelectionArtifact(artifacts.winnerSelectionPath),
    { expectedRunId: manifest.id },
  );
  const clarifyFollowUp = filterArtifactForConsultationRun(
    await readClarifyFollowUpArtifact(artifacts.clarifyFollowUpPath),
    { expectedRunId: manifest.id },
  );
  const researchBrief = filterArtifactForConsultationRun(
    await readResearchBriefArtifact(artifacts.researchBriefPath),
    { expectedRunId: manifest.id },
  );
  const failureAnalysis = filterArtifactForConsultationRun(
    await readFailureAnalysisArtifact(artifacts.failureAnalysisPath),
    { expectedRunId: manifest.id },
  );
  const profileSelectionArtifact = filterArtifactForConsultationRun(
    await readProfileSelectionArtifact(artifacts.profileSelectionPath),
    { expectedRunId: manifest.id },
  );
  const exportPlan = filterArtifactForConsultationRun(
    await readExportPlanArtifact(artifacts.crowningRecordPath),
    { expectedRunId: manifest.id },
  );
  const secondOpinionWinnerSelection = filterArtifactForConsultationRun(
    await readSecondOpinionWinnerSelectionArtifact(artifacts.secondOpinionWinnerSelectionPath),
    { expectedRunId: manifest.id },
  );

  return {
    comparisonMarkdownAvailable,
    hasExportedCandidate: manifest.candidates.some((candidate) => candidate.status === "exported"),
    ...(preflightReadiness ? { preflightReadiness } : {}),
    ...(winnerSelection ? { winnerSelection } : {}),
    ...(clarifyFollowUp ? { clarifyFollowUp } : {}),
    ...(researchBrief ? { researchBrief } : {}),
    ...(failureAnalysis ? { failureAnalysis } : {}),
    ...(profileSelectionArtifact ? { profileSelectionArtifact } : {}),
    ...(exportPlan ? { exportPlan } : {}),
    ...(secondOpinionWinnerSelection ? { secondOpinionWinnerSelection } : {}),
    ...(filteredComparisonReport ? { comparisonReport: filteredComparisonReport } : {}),
  };
}
