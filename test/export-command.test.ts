import type { Command } from "commander";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../src/services/exports.js", () => ({
  materializeExport: vi.fn(),
}));

import { buildProgram } from "../src/program.js";
import { materializeExport } from "../src/services/exports.js";

const mockedMaterializeExport = vi.mocked(materializeExport);

describe("promote command", () => {
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

  it("promotes the recommended result when no candidate id is provided", async () => {
    const program = createProgram();

    await program.parseAsync(["promote", "--branch", "fix/session-loss"], {
      from: "user",
    });

    expect(mockedMaterializeExport).toHaveBeenCalledWith({
      cwd: process.cwd(),
      branchName: "fix/session-loss",
      withReport: false,
    });
  });

  it("promotes an explicitly selected candidate when provided", async () => {
    const program = createProgram();

    await program.parseAsync(
      ["promote", "cand-02", "--consultation", "run_9", "--branch", "fix/session-loss"],
      { from: "user" },
    );

    expect(mockedMaterializeExport).toHaveBeenCalledWith({
      cwd: process.cwd(),
      runId: "run_9",
      winnerId: "cand-02",
      branchName: "fix/session-loss",
      withReport: false,
    });
  });
});

function createProgram() {
  const program = buildProgram();
  configureCommandTree(program);

  return program;
}

function configureCommandTree(program: Command) {
  program.exitOverride();
  program.configureOutput({
    writeErr() {},
    writeOut() {},
  });
  for (const command of program.commands) {
    configureCommandTree(command);
  }
}
