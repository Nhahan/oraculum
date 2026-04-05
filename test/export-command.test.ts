import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../src/services/exports.js", () => ({
  materializeExport: vi.fn(),
}));

import { buildProgram } from "../src/program.js";
import { materializeExport } from "../src/services/exports.js";

const mockedMaterializeExport = vi.mocked(materializeExport);

describe("export command", () => {
  beforeEach(() => {
    mockedMaterializeExport.mockReset();
    mockedMaterializeExport.mockResolvedValue({
      plan: {
        runId: "run_1",
        winnerId: "cand-01",
        branchName: "fix/session-loss",
        mode: "git-branch",
        workspaceDir: "/tmp/workspace",
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

    expect(mockedMaterializeExport).toHaveBeenCalledWith({
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

    expect(mockedMaterializeExport).toHaveBeenCalledWith({
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
