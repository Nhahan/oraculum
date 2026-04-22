import { mkdir } from "node:fs/promises";

import { describe, expect, it } from "vitest";

import {
  getClarifyFollowUpPath,
  getExportPlanPath,
  getFailureAnalysisPath,
  getFinalistComparisonJsonPath,
  getFinalistComparisonMarkdownPath,
  getPreflightReadinessPath,
  getProfileSelectionPath,
  getResearchBriefPath,
  getRunDir,
  getSecondOpinionWinnerSelectionPath,
  getWinnerSelectionPath,
} from "../src/core/paths.js";
import { consultToolResponseSchema } from "../src/domain/chat-native.js";
import { buildConsultationArtifacts } from "../src/services/chat-native.js";
import { resolveConsultationArtifacts } from "../src/services/consultation-artifacts.js";
import {
  createChatNativeTempRoot,
  registerChatNativeTempRootCleanup,
  writeTextArtifact,
} from "./helpers/chat-native.js";

registerChatNativeTempRootCleanup();

describe("chat-native consultation artifact filtering", () => {
  it("omits invalid machine-readable artifact paths from MCP responses", async () => {
    const projectRoot = await createChatNativeTempRoot("oraculum-chat-native-invalid-");
    const consultationId = "run_20260409_invalid";

    await mkdir(getRunDir(projectRoot, consultationId), { recursive: true });
    await writeTextArtifact(getPreflightReadinessPath(projectRoot, consultationId), "not-json\n");
    await writeTextArtifact(getClarifyFollowUpPath(projectRoot, consultationId), "{}\n");
    await writeTextArtifact(getResearchBriefPath(projectRoot, consultationId), "{}\n");
    await writeTextArtifact(getFailureAnalysisPath(projectRoot, consultationId), "{}\n");
    await writeTextArtifact(getProfileSelectionPath(projectRoot, consultationId), "{}\n");
    await writeTextArtifact(getFinalistComparisonJsonPath(projectRoot, consultationId), "{}\n");
    await writeTextArtifact(getWinnerSelectionPath(projectRoot, consultationId), "{}\n");
    await writeTextArtifact(getExportPlanPath(projectRoot, consultationId), "{}\n");
    await writeTextArtifact(
      getSecondOpinionWinnerSelectionPath(projectRoot, consultationId),
      "{}\n",
    );

    const parsed = consultToolResponseSchema.shape.artifacts.parse(
      buildConsultationArtifacts(projectRoot, consultationId, {
        hasExportedCandidate: false,
      }),
    );

    expect(parsed.preflightReadinessPath).toBeUndefined();
    expect(parsed.clarifyFollowUpPath).toBeUndefined();
    expect(parsed.researchBriefPath).toBeUndefined();
    expect(parsed.failureAnalysisPath).toBeUndefined();
    expect(parsed.profileSelectionPath).toBeUndefined();
    expect(parsed.comparisonJsonPath).toBeUndefined();
    expect(parsed.winnerSelectionPath).toBeUndefined();
    expect(parsed.secondOpinionWinnerSelectionPath).toBeUndefined();
    expect(parsed.crowningRecordPath).toBeUndefined();

    const state = await resolveConsultationArtifacts(projectRoot, consultationId);
    expect(state.artifactDiagnostics.map((diagnostic) => diagnostic.kind)).toEqual([
      "preflight-readiness",
      "clarify-follow-up",
      "research-brief",
      "failure-analysis",
      "profile-selection",
      "finalist-comparison",
      "winner-selection",
      "winner-selection-second-opinion",
      "crowning-record",
    ]);
    expect(state.artifactDiagnostics[0]).toMatchObject({
      path: getPreflightReadinessPath(projectRoot, consultationId),
      status: "invalid",
    });
  });

  it("omits blank comparison markdown paths from MCP responses", async () => {
    const projectRoot = await createChatNativeTempRoot("oraculum-chat-native-blank-md-");
    const consultationId = "run_20260409_blank_markdown";

    await mkdir(getRunDir(projectRoot, consultationId), { recursive: true });
    await writeTextArtifact(getFinalistComparisonMarkdownPath(projectRoot, consultationId), " \n");

    const parsed = consultToolResponseSchema.shape.artifacts.parse(
      buildConsultationArtifacts(projectRoot, consultationId, {
        hasExportedCandidate: false,
      }),
    );

    expect(parsed.comparisonMarkdownPath).toBeUndefined();
  });

  it("reports unreadable machine-readable artifacts separately from invalid JSON", async () => {
    const projectRoot = await createChatNativeTempRoot("oraculum-chat-native-unreadable-");
    const consultationId = "run_20260409_unreadable";
    const preflightReadinessPath = getPreflightReadinessPath(projectRoot, consultationId);

    await mkdir(preflightReadinessPath, { recursive: true });

    const state = await resolveConsultationArtifacts(projectRoot, consultationId);

    expect(state.preflightReadinessPath).toBeUndefined();
    expect(state.artifactDiagnostics).toEqual([
      expect.objectContaining({
        kind: "preflight-readiness",
        path: preflightReadinessPath,
        status: "invalid",
        message: expect.stringContaining("Unreadable artifact:"),
      }),
    ]);
  });

  it("omits artifact paths that do not exist on disk", async () => {
    const projectRoot = await createChatNativeTempRoot("oraculum-chat-native-missing-");
    const consultationId = "run_20260409_missing";

    await mkdir(getRunDir(projectRoot, consultationId), { recursive: true });

    const parsed = consultToolResponseSchema.shape.artifacts.parse(
      buildConsultationArtifacts(projectRoot, consultationId, {
        hasExportedCandidate: false,
      }),
    );

    expect(parsed.consultationRoot).toBe(getRunDir(projectRoot, consultationId));
    expect(parsed.configPath).toBeUndefined();
    expect(parsed.preflightReadinessPath).toBeUndefined();
    expect(parsed.clarifyFollowUpPath).toBeUndefined();
    expect(parsed.researchBriefPath).toBeUndefined();
    expect(parsed.failureAnalysisPath).toBeUndefined();
    expect(parsed.profileSelectionPath).toBeUndefined();
    expect(parsed.comparisonJsonPath).toBeUndefined();
    expect(parsed.comparisonMarkdownPath).toBeUndefined();
    expect(parsed.secondOpinionWinnerSelectionPath).toBeUndefined();
    expect(parsed.crowningRecordPath).toBeUndefined();
  });
});
