import { describe, expect, it } from "vitest";

import {
  createCompletedManifest,
  createMcpTempRoot,
  mockedListRecentConsultationRecords,
  mockedListRecentConsultations,
  mockedReadRunManifest,
  mockedRenderConsultationArchive,
  registerMcpToolsTestHarness,
  runVerdictArchiveTool,
  runVerdictTool,
} from "./helpers/mcp-tools-verdict.js";

registerMcpToolsTestHarness();

describe("chat-native MCP tools: verdict basics", () => {
  it("rejects unknown verdict request fields", async () => {
    await expect(
      runVerdictTool({
        cwd: "/tmp/project",
        consultationId: "run_1",
        includeDebug: true,
      } as Parameters<typeof runVerdictTool>[0]),
    ).rejects.toThrow(/Unrecognized key/);
    await expect(
      runVerdictArchiveTool({
        cwd: "/tmp/project",
        count: 3,
        format: "json",
      } as Parameters<typeof runVerdictArchiveTool>[0]),
    ).rejects.toThrow(/Unrecognized key/);

    expect(mockedReadRunManifest).not.toHaveBeenCalled();
    expect(mockedListRecentConsultationRecords).not.toHaveBeenCalled();
  });

  it("rejects unsafe consultation ids before reading artifacts", async () => {
    await expect(
      runVerdictTool({
        cwd: "/tmp/project",
        consultationId: "../run",
      }),
    ).rejects.toThrow("Artifact ids must be safe single path segments.");

    expect(mockedReadRunManifest).not.toHaveBeenCalled();
  });

  it("reopens verdicts and archives through MCP tools", async () => {
    const verdict = await runVerdictTool({
      cwd: "/tmp/project",
      consultationId: "run_9",
    });
    const archive = await runVerdictArchiveTool({
      cwd: "/tmp/project",
      count: 5,
    });

    expect(mockedReadRunManifest).toHaveBeenCalledWith("/tmp/project", "run_9");
    expect(mockedListRecentConsultationRecords).toHaveBeenCalledWith("/tmp/project", 5);
    expect(mockedListRecentConsultations).not.toHaveBeenCalled();
    expect(verdict.mode).toBe("verdict");
    expect(verdict.status).toMatchObject({
      consultationId: "run_1",
      outcomeType: "recommended-survivor",
      taskSourceKind: "task-note",
      taskSourcePath: "/tmp/task.md",
      validationProfileId: "library",
      validationSummary: "Package export evidence is strongest.",
      validationSignals: ["package-export"],
      validationGaps: [],
      researchRerunRecommended: false,
      nextActions: ["reopen-verdict", "browse-archive", "crown-recommended-result"],
    });
    expect(verdict.review).toMatchObject({
      outcomeType: "recommended-survivor",
      recommendedCandidateId: "cand-01",
      finalistIds: ["cand-01"],
      validationProfileId: "library",
      validationSignals: ["package-export"],
      profileId: "library",
    });
    expect(archive.mode).toBe("verdict-archive");
  });

  it("renders verdict archive display paths against the resolved project root", async () => {
    const root = await createMcpTempRoot("oraculum-mcp-archive-root-");
    const nestedCwd = `${root}/packages/app`;
    const fs = await import("node:fs/promises");
    await fs.mkdir(`${root}/.oraculum`, { recursive: true });
    await fs.writeFile(`${root}/.oraculum/config.json`, "{}\n", "utf8");
    await fs.mkdir(nestedCwd, { recursive: true });

    await runVerdictArchiveTool({
      cwd: nestedCwd,
      count: 3,
    });

    expect(mockedListRecentConsultationRecords).toHaveBeenCalledWith(nestedCwd, 3);
    expect(mockedRenderConsultationArchive).toHaveBeenCalledWith([createCompletedManifest()], {
      projectRoot: root,
      surface: "chat-native",
    });
  });
});
