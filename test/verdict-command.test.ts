import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../src/services/runs.js", () => ({
  readLatestRunManifest: vi.fn(),
  readRunManifest: vi.fn(),
}));

import { buildProgram } from "../src/program.js";
import { readLatestRunManifest, readRunManifest } from "../src/services/runs.js";
import { captureStdout } from "./helpers/stdout.js";

const mockedReadLatestRunManifest = vi.mocked(readLatestRunManifest);
const mockedReadRunManifest = vi.mocked(readRunManifest);

describe("verdict command", () => {
  beforeEach(() => {
    mockedReadLatestRunManifest.mockReset();
    mockedReadRunManifest.mockReset();
  });

  it("shows that the comparison report is not available for planned consultations", async () => {
    const program = createProgram();
    mockedReadRunManifest.mockResolvedValue(createManifest("planned"));

    const output = await captureStdout(async () => {
      await program.parseAsync(["verdict", "run_1"], { from: "user" });
    });

    expect(output).toContain("Comparison report: not available yet");
  });

  it("prints the saved comparison report path for completed consultations", async () => {
    const program = createProgram();
    mockedReadLatestRunManifest.mockResolvedValue(createManifest("completed"));

    const output = await captureStdout(async () => {
      await program.parseAsync(["verdict"], { from: "user" });
    });

    expect(output).toContain(".oraculum/runs/run_1/reports/comparison.md");
    expect(output).toContain("Recommended promotion: cand-01 (high, llm-judge)");
    expect(output).toContain("Finalists:");
    expect(output).toContain("- cand-01: Minimal Change");
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
