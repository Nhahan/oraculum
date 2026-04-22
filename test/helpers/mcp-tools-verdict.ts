import { mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

import { vi } from "vitest";

vi.mock("../../src/core/subprocess.js", () => ({
  runSubprocess: vi.fn(),
}));

vi.mock("../../src/services/runs.js", () => ({
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
  isInvalidConsultationRecord: vi.fn(),
  listRecentConsultationRecords: vi.fn(),
  listRecentConsultations: vi.fn(),
  renderConsultationArchive: vi.fn(),
  renderConsultationSummary: vi.fn(),
}));

vi.mock("../../src/services/exports.js", () => ({
  materializeExport: vi.fn(),
}));

const mcpToolsServiceModule = await import("../../src/services/mcp-tools.js");
const pathsModule = await import("../../src/core/paths.js");
const runDomainModule = await import("../../src/domain/run.js");
const finalistReportModule = await import("../../src/services/finalist-report.js");
const mcpToolsHelperModule = await import("./mcp-tools.js");

export const runVerdictArchiveTool = mcpToolsServiceModule.runVerdictArchiveTool;
export const runVerdictTool = mcpToolsServiceModule.runVerdictTool;

export const getExportPlanPath = pathsModule.getExportPlanPath;
export const getFinalistComparisonJsonPath = pathsModule.getFinalistComparisonJsonPath;
export const getFinalistComparisonMarkdownPath = pathsModule.getFinalistComparisonMarkdownPath;
export const getSecondOpinionWinnerSelectionPath = pathsModule.getSecondOpinionWinnerSelectionPath;

export const exportPlanSchema = runDomainModule.exportPlanSchema;
export const comparisonReportSchema = finalistReportModule.comparisonReportSchema;

export const createCandidate = mcpToolsHelperModule.createCandidate;
export const createCompletedManifest = mcpToolsHelperModule.createCompletedManifest;
export const createFinalistsWithoutRecommendationManifest =
  mcpToolsHelperModule.createFinalistsWithoutRecommendationManifest;
export const createMcpTempRoot = mcpToolsHelperModule.createMcpTempRoot;
export const mockedBuildVerdictReview = mcpToolsHelperModule.mockedBuildVerdictReview;
export const mockedHasNonEmptyTextArtifact = mcpToolsHelperModule.mockedHasNonEmptyTextArtifact;
export const mockedListRecentConsultations = mcpToolsHelperModule.mockedListRecentConsultations;
export const mockedListRecentConsultationRecords =
  mcpToolsHelperModule.mockedListRecentConsultationRecords;
export const mockedReadRunManifest = mcpToolsHelperModule.mockedReadRunManifest;
export const mockedRenderConsultationArchive = mcpToolsHelperModule.mockedRenderConsultationArchive;
export const registerMcpToolsTestHarness = mcpToolsHelperModule.registerMcpToolsTestHarness;
export const writeComparisonReportJson = mcpToolsHelperModule.writeComparisonReportJson;
export const writeComparisonReportMarkdown = mcpToolsHelperModule.writeComparisonReportMarkdown;
export const writeDisagreeingSecondOpinionSelection =
  mcpToolsHelperModule.writeDisagreeingSecondOpinionSelection;
export const writeExportPlanArtifact = mcpToolsHelperModule.writeExportPlanArtifact;
export const writeUnavailableSecondOpinionSelection =
  mcpToolsHelperModule.writeUnavailableSecondOpinionSelection;
export const writeTextArtifact = mcpToolsHelperModule.writeTextArtifact;

export async function writeMalformedComparisonJson(path: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, "{\n", "utf8");
}
