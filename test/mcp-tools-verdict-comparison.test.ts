import { describe, expect, it } from "vitest";

import {
  createFinalistsWithoutRecommendationManifest,
  createMcpTempRoot,
  getFinalistComparisonJsonPath,
  getFinalistComparisonMarkdownPath,
  mockedHasNonEmptyTextArtifact,
  mockedReadRunManifest,
  registerMcpToolsTestHarness,
  runVerdictTool,
  writeComparisonReportJson,
  writeComparisonReportMarkdown,
  writeMalformedComparisonJson,
} from "./helpers/mcp-tools-verdict.js";

registerMcpToolsTestHarness();

describe("chat-native MCP tools: verdict comparison artifacts", () => {
  it("omits inspect-comparison-report from verdict status when no comparison artifact is available", async () => {
    const root = await createMcpTempRoot("oraculum-mcp-missing-comparison-");
    mockedReadRunManifest.mockResolvedValue(createFinalistsWithoutRecommendationManifest());

    const verdict = await runVerdictTool({
      cwd: root,
      consultationId: "run_9",
    });

    expect(verdict.status.nextActions).toEqual([
      "reopen-verdict",
      "browse-archive",
      "rerun-with-different-candidate-count",
    ]);
  });

  it("keeps inspect-comparison-report in verdict status when only comparison json is available", async () => {
    const root = await createMcpTempRoot("oraculum-mcp-json-only-comparison-");
    mockedReadRunManifest.mockResolvedValue(createFinalistsWithoutRecommendationManifest());

    await writeComparisonReportJson(root, "run_1", {
      finalistCount: 2,
    });

    const verdict = await runVerdictTool({
      cwd: root,
      consultationId: "run_9",
    });

    expect(verdict.status.nextActions).toEqual([
      "reopen-verdict",
      "browse-archive",
      "inspect-comparison-report",
      "rerun-with-different-candidate-count",
    ]);
  });

  it("keeps inspect-comparison-report in verdict status when json is malformed but markdown is valid", async () => {
    const root = await createMcpTempRoot("oraculum-mcp-markdown-fallback-");
    mockedReadRunManifest.mockResolvedValue(createFinalistsWithoutRecommendationManifest());

    const comparisonJsonPath = getFinalistComparisonJsonPath(root, "run_1");
    const comparisonMarkdownPath = getFinalistComparisonMarkdownPath(root, "run_1");
    await writeMalformedComparisonJson(comparisonJsonPath);
    await writeComparisonReportMarkdown(
      root,
      "run_1",
      "# Finalist Comparison\n\n- Run: run_1\n\nCandidate notes.\n",
    );
    mockedHasNonEmptyTextArtifact.mockImplementation(
      async (path) => path === comparisonMarkdownPath,
    );

    const verdict = await runVerdictTool({
      cwd: root,
      consultationId: "run_9",
    });

    expect(verdict.status.nextActions).toEqual([
      "reopen-verdict",
      "browse-archive",
      "inspect-comparison-report",
      "rerun-with-different-candidate-count",
    ]);
  });
});
