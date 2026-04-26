import { join } from "node:path";

import type { Command } from "commander";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../src/services/orc-actions.js", () => ({
  runConsultAction: vi.fn(),
  runCrownAction: vi.fn(),
  runPlanAction: vi.fn(),
  runUserInteractionAnswerAction: vi.fn(),
  runVerdictAction: vi.fn(),
}));

import { buildProgram } from "../src/program.js";
import {
  runConsultAction,
  runPlanAction,
  runUserInteractionAnswerAction,
  runVerdictAction,
} from "../src/services/orc-actions.js";
import { captureStdout } from "./helpers/stdout.js";

const mockedRunConsultAction = vi.mocked(runConsultAction);
const mockedRunPlanAction = vi.mocked(runPlanAction);
const mockedRunUserInteractionAnswerAction = vi.mocked(runUserInteractionAnswerAction);
const mockedRunVerdictAction = vi.mocked(runVerdictAction);

describe("orc command", () => {
  beforeEach(() => {
    mockedRunConsultAction.mockReset();
    mockedRunPlanAction.mockReset();
    mockedRunUserInteractionAnswerAction.mockReset();
    mockedRunVerdictAction.mockReset();
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
    mockedRunUserInteractionAnswerAction.mockResolvedValue({
      mode: "plan",
      summary: "Plan answer summary.",
      artifacts: {
        consultationPlanPath: join(
          process.cwd(),
          ".oraculum",
          "runs",
          "run_2",
          "reports",
          "consultation-plan.json",
        ),
      },
    } as never);
    mockedRunVerdictAction.mockResolvedValue({
      mode: "verdict",
      summary: "Verdict summary.",
    } as never);
  });

  it("allows bare consult and forwards no taskInput", async () => {
    const program = createProgram();

    await captureStdout(async () => {
      await program.parseAsync(["orc", "consult"], { from: "user" });
    });

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

  it("prints user interaction questions instead of the consult tail when active", async () => {
    mockedRunPlanAction.mockResolvedValueOnce({
      mode: "plan",
      summary: "Plan summary.",
      status: {
        outcomeType: "needs-clarification",
      },
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
      userInteraction: {
        kind: "augury-question",
        runId: "run_1",
        header: "Augury",
        question: "Which route should be protected?",
        expectedAnswerShape: "Name the route and success signal.",
        options: [
          {
            label: "Protect dashboard",
            description: "Protect /dashboard and prove redirects.",
          },
          {
            label: "Protect admin",
            description: "Protect /admin and prove redirects.",
          },
        ],
        freeTextAllowed: true,
        round: 1,
        maxRounds: 8,
      },
    } as never);
    const program = createProgram();

    const output = await captureStdout(async () => {
      await program.parseAsync(["orc", "plan", "fix", "login"], { from: "user" });
    });

    expect(output).toContain("Clarification needed (Augury): Which route should be protected?");
    expect(output).toContain("Expected answer: Name the route and success signal.");
    expect(output).toContain("1. Protect dashboard - Protect /dashboard and prove redirects.");
    expect(output).toContain(
      'Next: answer in the host UI, or run `orc answer augury-question run_1 "<answer>"`.',
    );
    expect(output).not.toContain("Next: run `orc consult");
  });
  it("prints common user interactions for consult and verdict output", async () => {
    mockedRunConsultAction.mockResolvedValueOnce({
      mode: "consult",
      summary: "Consult summary.",
      userInteraction: {
        kind: "consult-clarification",
        runId: "run_1",
        header: "Consult clarification",
        question: "Which file should Oraculum update?",
        expectedAnswerShape: "Name the file and success signal.",
        freeTextAllowed: true,
      },
    } as never);
    mockedRunVerdictAction.mockResolvedValueOnce({
      mode: "verdict",
      summary: "Verdict summary.",
      userInteraction: {
        kind: "plan-clarification",
        runId: "run_2",
        header: "Plan clarification",
        question: "Which scope should the plan preserve?",
        expectedAnswerShape: "Name the scope and judging basis.",
        freeTextAllowed: true,
      },
    } as never);
    const program = createProgram();

    const consultOutput = await captureStdout(async () => {
      await program.parseAsync(["orc", "consult", "fix", "login"], { from: "user" });
    });
    const verdictOutput = await captureStdout(async () => {
      await program.parseAsync(["orc", "verdict", "run_2"], { from: "user" });
    });

    expect(consultOutput).toContain(
      'Next: answer in the host UI, or run `orc answer consult-clarification run_1 "<answer>"`.',
    );
    expect(verdictOutput).toContain(
      'Next: answer in the host UI, or run `orc answer plan-clarification run_2 "<answer>"`.',
    );
  });
  it("forwards common interaction answers to the answer action", async () => {
    const program = createProgram();

    await captureStdout(async () => {
      await program.parseAsync(
        ["orc", "answer", "consult-clarification", "run_1", "Protect", "/dashboard"],
        {
          from: "user",
        },
      );
    });

    expect(mockedRunUserInteractionAnswerAction).toHaveBeenCalledWith({
      cwd: process.cwd(),
      kind: "consult-clarification",
      runId: "run_1",
      answer: "Protect /dashboard",
    });
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
