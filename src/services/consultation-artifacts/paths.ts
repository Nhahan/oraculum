import { isAbsolute, normalize, relative, resolve as resolvePath } from "node:path";

import { RunStore } from "../run-store.js";
import { toPortableRelativePath, toPreservedAbsolutePath } from "./shared.js";
import type { ConsultationArtifactPaths } from "./types.js";

export function normalizeConsultationScopePath(projectRoot: string, path: string): string {
  if (!isAbsolute(path)) {
    const resolvedPath = normalize(resolvePath(projectRoot, path));
    const relativePath = relative(projectRoot, resolvedPath);
    if (
      relativePath.length === 0 ||
      relativePath === "." ||
      relativePath.startsWith("..") ||
      isAbsolute(relativePath)
    ) {
      return resolvedPath;
    }
    return toPortableRelativePath(relativePath);
  }

  const normalizedPath = normalize(path);
  const relativePath = relative(projectRoot, normalizedPath);
  if (
    relativePath.length === 0 ||
    relativePath === "." ||
    relativePath.startsWith("..") ||
    isAbsolute(relativePath)
  ) {
    return toPreservedAbsolutePath(path, normalizedPath);
  }

  return toPortableRelativePath(relativePath);
}

export function buildConsultationArtifactPathCandidates(
  cwd: string,
  consultationId: string,
): ConsultationArtifactPaths {
  const store = new RunStore(cwd);
  const runPaths = store.getRunPaths(consultationId);
  return {
    consultationRoot: runPaths.runDir,
    configPath: runPaths.configPath,
    consultationPlanPath: runPaths.consultationPlanPath,
    consultationPlanMarkdownPath: runPaths.consultationPlanMarkdownPath,
    preflightReadinessPath: runPaths.preflightReadinessPath,
    clarifyFollowUpPath: runPaths.clarifyFollowUpPath,
    researchBriefPath: runPaths.researchBriefPath,
    failureAnalysisPath: runPaths.failureAnalysisPath,
    profileSelectionPath: runPaths.profileSelectionPath,
    comparisonJsonPath: runPaths.comparisonJsonPath,
    comparisonMarkdownPath: runPaths.comparisonMarkdownPath,
    winnerSelectionPath: runPaths.winnerSelectionPath,
    secondOpinionWinnerSelectionPath: runPaths.secondOpinionWinnerSelectionPath,
    crowningRecordPath: runPaths.exportPlanPath,
  };
}
