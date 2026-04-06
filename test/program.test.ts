import type { Command } from "commander";
import { describe, expect, it } from "vitest";

import { buildProgram } from "../src/program.js";

describe("CLI argument parsing", () => {
  it("rejects non-numeric candidate counts before executing the command", async () => {
    const program = createProgram();

    await expect(
      program.parseAsync(["consult", "tasks/task.md", "--candidates", "abc"], { from: "user" }),
    ).rejects.toMatchObject({
      code: "commander.invalidArgument",
    });
  });

  it("rejects non-numeric timeouts before executing the command", async () => {
    const program = createProgram();

    await expect(
      program.parseAsync(["consult", "tasks/task.md", "--timeout-ms", "abc"], { from: "user" }),
    ).rejects.toMatchObject({
      code: "commander.invalidArgument",
    });
  });

  it("rejects partially numeric candidate counts", async () => {
    const program = createProgram();

    await expect(
      program.parseAsync(["consult", "tasks/task.md", "--candidates", "3abc"], { from: "user" }),
    ).rejects.toMatchObject({
      code: "commander.invalidArgument",
    });
  });

  it("rejects partially numeric candidate counts for consult draft", async () => {
    const program = createProgram();

    await expect(
      program.parseAsync(["consult", "draft", "tasks/task.md", "--candidates", "3abc"], {
        from: "user",
      }),
    ).rejects.toMatchObject({
      code: "commander.invalidArgument",
    });
  });

  it("rejects partially numeric timeouts", async () => {
    const program = createProgram();

    await expect(
      program.parseAsync(["consult", "tasks/task.md", "--timeout-ms", "100ms"], {
        from: "user",
      }),
    ).rejects.toMatchObject({
      code: "commander.invalidArgument",
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
