import { join } from "node:path";

import type { Command } from "commander";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../src/services/orc-actions.js", () => ({
  runConsultAction: vi.fn(),
  runCrownAction: vi.fn(),
  runPlanAction: vi.fn(),
  runVerdictAction: vi.fn(),
}));

import { buildProgram } from "../src/program.js";
import { runConsultAction, runPlanAction } from "../src/services/orc-actions.js";
import { captureStdout } from "./helpers/stdout.js";

const mockedRunConsultAction = vi.mocked(runConsultAction);
const mockedRunPlanAction = vi.mocked(runPlanAction);

describe("orc command", () => {
  beforeEach(() => {
    mockedRunConsultAction.mockReset();
    mockedRunPlanAction.mockReset();
    mockedRunConsultAction.mockResolvedValue({
      mode: "consult",
      summary: "Consultation summary.",
    } as never);
    mockedRunPlanAction.mockResolvedValue({
      mode: "plan",
      summary: "Plan summary.",
      artifacts: {
        consultationPlanPath: join(
          process.cwd(),
          ".oraculum",
          "runs",
          "run_1",
          "reports",
          "consultation-plan.json",
        ),
      },
    } as never);
  });

  it("allows bare consult and forwards no taskInput", async () => {
    const program = createProgram();

    await program.parseAsync(["orc", "consult"], { from: "user" });

    expect(mockedRunConsultAction).toHaveBeenCalledWith({
      cwd: process.cwd(),
    });
  });

  it("prints plan continuation tail after the summary", async () => {
    const program = createProgram();

    const output = await captureStdout(async () => {
      await program.parseAsync(["orc", "plan", "fix", "login"], { from: "user" });
    });

    expect(output).toContain("Plan summary.");
    expect(output).toContain("Plan path: .oraculum/runs/run_1/reports/consultation-plan.json");
    expect(
      output
        .trimEnd()
        .endsWith(
          "Next: run `orc consult .oraculum/runs/run_1/reports/consultation-plan.json` to continue this plan.",
        ),
    ).toBe(true);
  });

  it("rejects the removed draft subcommand", async () => {
    const program = createProgram();

    await expect(
      program.parseAsync(["orc", "draft", "fix", "login"], { from: "user" }),
    ).rejects.toMatchObject({
      code: "commander.unknownCommand",
    });
  });

  it("rejects the removed init subcommand", async () => {
    const program = createProgram();

    await expect(program.parseAsync(["orc", "init"], { from: "user" })).rejects.toMatchObject({
      code: "commander.unknownCommand",
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
