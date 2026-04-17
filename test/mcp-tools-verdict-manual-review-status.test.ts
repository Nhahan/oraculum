import { describe, expect, it } from "vitest";

import {
  createCandidate,
  createCompletedManifest,
  createMcpTempRoot,
  mockedReadRunManifest,
  registerMcpToolsTestHarness,
  runVerdictTool,
  writeDisagreeingSecondOpinionSelection,
  writeExportPlanArtifact,
  writeUnavailableSecondOpinionSelection,
} from "./helpers/mcp-tools-verdict.js";

registerMcpToolsTestHarness();

describe("chat-native MCP tools: verdict manual review status", () => {
  it("omits direct crown from verdict status when second-opinion manual review is required", async () => {
    const root = await createMcpTempRoot("oraculum-mcp-second-opinion-status-");
    mockedReadRunManifest.mockResolvedValue(createCompletedManifest());

    await writeDisagreeingSecondOpinionSelection(root, "run_1", {
      triggerKinds: ["many-changed-paths"],
      triggerReasons: ["A finalist changed 3 paths, meeting the second-opinion threshold (1)."],
      primaryConfidence: "high",
      primarySummary: "cand-01 is the recommended promotion.",
      resultSummary: "Manual review is safer before crowning.",
      resultRunnerSummary: "Second opinion abstained.",
      advisorySummary:
        "Second-opinion judge abstained, while the primary path selected a finalist.",
    });

    const verdict = await runVerdictTool({
      cwd: root,
      consultationId: "run_9",
    });

    expect(verdict.status.nextActions).toEqual([
      "reopen-verdict",
      "browse-archive",
      "perform-manual-review",
    ]);
  });

  it("omits direct crown from verdict status when second-opinion is unavailable", async () => {
    const root = await createMcpTempRoot("oraculum-mcp-second-opinion-unavailable-");
    mockedReadRunManifest.mockResolvedValue(createCompletedManifest());

    await writeUnavailableSecondOpinionSelection(root, "run_1", {
      triggerKinds: ["low-confidence"],
      triggerReasons: ["Primary judge confidence was low."],
      primaryConfidence: "high",
      primarySummary: "cand-01 is the recommended promotion.",
      resultSummary: "Second opinion was unavailable.",
      advisorySummary:
        "Manual review is still required because the second opinion was unavailable.",
    });

    const verdict = await runVerdictTool({
      cwd: root,
      consultationId: "run_9",
    });

    expect(verdict.status.nextActions).toEqual([
      "reopen-verdict",
      "browse-archive",
      "perform-manual-review",
    ]);
  });

  it("omits direct crown from verdict status when a crowning record already exists", async () => {
    const root = await createMcpTempRoot("oraculum-mcp-crowning-record-status-");
    mockedReadRunManifest.mockResolvedValue({
      ...createCompletedManifest(),
      candidates: [
        createCandidate("cand-01", {
          status: "exported",
          workspaceDir: "/tmp/cand-01",
          taskPacketPath: "/tmp/cand-01.json",
        }),
      ],
    });

    await writeExportPlanArtifact(root, "run_1", "cand-01");

    const verdict = await runVerdictTool({
      cwd: root,
      consultationId: "run_9",
    });

    expect(verdict.status.nextActions).toEqual(["reopen-verdict", "browse-archive"]);
  });

  it("keeps manual review explicit when a crowning record and second-opinion blocker both exist", async () => {
    const root = await createMcpTempRoot("oraculum-mcp-crowning-manual-review-");
    mockedReadRunManifest.mockResolvedValue({
      ...createCompletedManifest(),
      candidates: [
        createCandidate("cand-01", {
          status: "exported",
          workspaceDir: "/tmp/cand-01",
          taskPacketPath: "/tmp/cand-01.json",
        }),
      ],
    });

    await writeExportPlanArtifact(root, "run_1", "cand-01");
    await writeUnavailableSecondOpinionSelection(root, "run_1", {
      triggerKinds: ["low-confidence"],
      triggerReasons: ["Primary judge confidence was low."],
      primaryConfidence: "high",
      primarySummary: "cand-01 is the recommended promotion.",
      resultSummary: "Second opinion was unavailable.",
      advisorySummary:
        "Manual review is still required because the second opinion was unavailable.",
    });

    const verdict = await runVerdictTool({
      cwd: root,
      consultationId: "run_9",
    });

    expect(verdict.status.nextActions).toEqual([
      "reopen-verdict",
      "browse-archive",
      "perform-manual-review",
    ]);
  });
});
