import { mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

import { vi } from "vitest";

vi.mock("../../src/core/subprocess.js", () => ({
  runSubprocess: vi.fn(),
}));

vi.mock("../../src/services/runs.js", () => ({
  answerPlanRun: vi.fn(),
  planRun: vi.fn(),
  readLatestRunManifest: vi.fn(),
  readRunManifest: vi.fn(),
  writeLatestRunState: vi.fn(),
}));

vi.mock("../../src/services/execution.js", () => ({
  executeRun: vi.fn(),
}));

vi.mock("../../src/services/project.js", async () => {
  const actual = await vi.importActual<typeof import("../../src/services/project.js")>(
    "../../src/services/project.js",
  );

  return {
    ...actual,
    ensureProjectInitialized: vi.fn(),
    hasNonEmptyTextArtifact: vi.fn(() => false),
    hasNonEmptyTextArtifactSync: vi.fn(() => false),
    initializeProject: vi.fn(),
  };
});

vi.mock("../../src/services/consultations.js", () => ({
  buildVerdictReview: vi.fn(),
  renderConsultationSummary: vi.fn(),
}));

vi.mock("../../src/services/exports.js", () => ({
  materializeExport: vi.fn(),
}));

const orcActionsServiceModule = await import("../../src/services/orc-actions.js");
const pathsModule = await import("../../src/core/paths.js");
const runDomainModule = await import("../../src/domain/run.js");
const finalistReportModule = await import("../../src/services/finalist-report.js");
const orcActionsHelperModule = await import("./orc-actions.js");

export const runVerdictAction = orcActionsServiceModule.runVerdictAction;

export const getExportPlanPath = pathsModule.getExportPlanPath;
export const getFinalistComparisonJsonPath = pathsModule.getFinalistComparisonJsonPath;
export const getFinalistComparisonMarkdownPath = pathsModule.getFinalistComparisonMarkdownPath;
export const getSecondOpinionWinnerSelectionPath = pathsModule.getSecondOpinionWinnerSelectionPath;

export const exportPlanSchema = runDomainModule.exportPlanSchema;
export const comparisonReportSchema = finalistReportModule.comparisonReportSchema;

export const createCandidate = orcActionsHelperModule.createCandidate;
export const createBlockedPreflightManifest = orcActionsHelperModule.createBlockedPreflightManifest;
export const createCompletedManifest = orcActionsHelperModule.createCompletedManifest;
export const createFinalistsWithoutRecommendationManifest =
  orcActionsHelperModule.createFinalistsWithoutRecommendationManifest;
export const createOrcActionTempRoot = orcActionsHelperModule.createOrcActionTempRoot;
export const mockedBuildVerdictReview = orcActionsHelperModule.mockedBuildVerdictReview;
export const mockedHasNonEmptyTextArtifact = orcActionsHelperModule.mockedHasNonEmptyTextArtifact;
export const mockedReadRunManifest = orcActionsHelperModule.mockedReadRunManifest;
export const registerOrcActionsTestHarness = orcActionsHelperModule.registerOrcActionsTestHarness;
export const writeComparisonReportJson = orcActionsHelperModule.writeComparisonReportJson;
export const writeComparisonReportMarkdown = orcActionsHelperModule.writeComparisonReportMarkdown;
export const writeDisagreeingSecondOpinionSelection =
  orcActionsHelperModule.writeDisagreeingSecondOpinionSelection;
export const writeExportPlanArtifact = orcActionsHelperModule.writeExportPlanArtifact;
export const writeUnavailableSecondOpinionSelection =
  orcActionsHelperModule.writeUnavailableSecondOpinionSelection;
export const writeTextArtifact = orcActionsHelperModule.writeTextArtifact;

export async function writeMalformedComparisonJson(path: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, "{\n", "utf8");
}
