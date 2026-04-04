import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../src/services/runs.js", () => ({
  buildExportPlan: vi.fn(),
}));

import { buildProgram } from "../src/program.js";
import { buildExportPlan } from "../src/services/runs.js";

const mockedBuildExportPlan = vi.mocked(buildExportPlan);

describe("export command", () => {
  beforeEach(() => {
    mockedBuildExportPlan.mockReset();
    mockedBuildExportPlan.mockResolvedValue({
      plan: {
        runId: "run_1",
        winnerId: "cand-01",
        branchName: "fix/session-loss",
        withReport: false,
        createdAt: "2026-04-05T00:00:00.000Z",
      },
      path: "/tmp/export-plan.json",
    });
  });

  it("exports the recommended winner when no candidate id is provided", async () => {
    const program = createProgram();

    await program.parseAsync(["export", "--branch", "fix/session-loss"], {
      from: "user",
    });

    expect(mockedBuildExportPlan).toHaveBeenCalledWith({
      cwd: process.cwd(),
      branchName: "fix/session-loss",
      withReport: false,
    });
  });

  it("exports an explicitly selected candidate when provided", async () => {
    const program = createProgram();

    await program.parseAsync(["export", "cand-02", "--branch", "fix/session-loss"], {
      from: "user",
    });

    expect(mockedBuildExportPlan).toHaveBeenCalledWith({
      cwd: process.cwd(),
      winnerId: "cand-02",
      branchName: "fix/session-loss",
      withReport: false,
    });
  });
});

function createProgram() {
  const program = buildProgram();
  program.exitOverride();
  program.configureOutput({
    writeErr() {},
    writeOut() {},
  });
  for (const command of program.commands) {
    command.exitOverride();
    command.configureOutput({
      writeErr() {},
      writeOut() {},
    });
  }

  return program;
}
