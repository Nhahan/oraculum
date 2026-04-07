import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../src/services/runs.js", () => ({
  readLatestRunManifest: vi.fn(),
  readRunManifest: vi.fn(),
}));

vi.mock("../src/services/consultations.js", () => ({
  listRecentConsultations: vi.fn(),
  renderConsultationArchive: vi.fn(),
  renderConsultationSummary: vi.fn(),
}));

import { buildProgram } from "../src/program.js";
import {
  listRecentConsultations,
  renderConsultationArchive,
  renderConsultationSummary,
} from "../src/services/consultations.js";
import { readLatestRunManifest, readRunManifest } from "../src/services/runs.js";
import { captureStdout } from "./helpers/stdout.js";

const mockedListRecentConsultations = vi.mocked(listRecentConsultations);
const mockedReadLatestRunManifest = vi.mocked(readLatestRunManifest);
const mockedReadRunManifest = vi.mocked(readRunManifest);
const mockedRenderConsultationArchive = vi.mocked(renderConsultationArchive);
const mockedRenderConsultationSummary = vi.mocked(renderConsultationSummary);

describe("verdict command", () => {
  beforeEach(() => {
    mockedReadLatestRunManifest.mockReset();
    mockedReadRunManifest.mockReset();
    mockedListRecentConsultations.mockReset();
    mockedRenderConsultationArchive.mockReset();
    mockedRenderConsultationSummary.mockReset();
    mockedRenderConsultationSummary.mockResolvedValue("Consultation summary.\n");
    mockedRenderConsultationArchive.mockReturnValue("Recent consultations.\n");
  });

  it("shows the rendered summary for planned consultations", async () => {
    const program = createProgram();
    mockedReadRunManifest.mockResolvedValue(createManifest("planned"));

    const output = await captureStdout(async () => {
      await program.parseAsync(["verdict", "run_1"], { from: "user" });
    });

    expect(output).toContain("Consultation summary.");
  });

  it("prints the rendered summary for completed consultations", async () => {
    const program = createProgram();
    mockedReadLatestRunManifest.mockResolvedValue(createManifest("completed"));

    const output = await captureStdout(async () => {
      await program.parseAsync(["verdict"], { from: "user" });
    });

    expect(output).toContain("Consultation summary.");
  });

  it("prints a rendered archive of recent consultations", async () => {
    const program = createProgram();
    mockedListRecentConsultations.mockResolvedValue([createManifest("completed")]);

    const output = await captureStdout(async () => {
      await program.parseAsync(["verdict", "archive", "5"], { from: "user" });
    });

    expect(mockedListRecentConsultations).toHaveBeenCalledWith(process.cwd(), 5);
    expect(output).toContain("Recent consultations.");
  });
});

function createProgram() {
  const program = buildProgram();
  program.exitOverride();
  return program;
}

function createManifest(status: "planned" | "completed") {
  return {
    id: "run_1",
    status,
    taskPath: "/tmp/task.md",
    taskPacket: {
      id: "task",
      title: "Task",
      sourceKind: "task-note" as const,
      sourcePath: "/tmp/task.md",
    },
    agent: "codex" as const,
    candidateCount: 1,
    createdAt: "2026-04-04T00:00:00.000Z",
    rounds: [
      {
        id: "fast" as const,
        label: "Fast",
        status: status === "completed" ? ("completed" as const) : ("pending" as const),
        verdictCount: 0,
        survivorCount: 0,
        eliminatedCount: 0,
      },
    ],
    candidates: [
      {
        id: "cand-01",
        strategyId: "minimal-change",
        strategyLabel: "Minimal Change",
        status: status === "completed" ? ("promoted" as const) : ("planned" as const),
        workspaceDir: "/tmp/workspace",
        taskPacketPath: "/tmp/task-packet.json",
        repairCount: 0,
        repairedRounds: [],
        createdAt: "2026-04-04T00:00:00.000Z",
      },
    ],
    ...(status === "completed"
      ? {
          recommendedWinner: {
            candidateId: "cand-01",
            confidence: "high" as const,
            source: "llm-judge" as const,
            summary: "cand-01 is the recommended promotion.",
          },
        }
      : {}),
  };
}
