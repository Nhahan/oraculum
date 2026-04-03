import { describe, expect, it } from "vitest";

import { buildProgram } from "../src/program.js";

describe("CLI argument parsing", () => {
  it("rejects non-numeric candidate counts before executing the command", async () => {
    const program = createProgram();

    await expect(
      program.parseAsync(["run", "--task", "tasks/task.md", "--candidates", "abc"], {
        from: "user",
      }),
    ).rejects.toMatchObject({
      code: "commander.invalidArgument",
    });
  });

  it("rejects non-numeric timeouts before executing the command", async () => {
    const program = createProgram();

    await expect(
      program.parseAsync(["run", "--task", "tasks/task.md", "--timeout-ms", "abc"], {
        from: "user",
      }),
    ).rejects.toMatchObject({
      code: "commander.invalidArgument",
    });
  });

  it("rejects partially numeric candidate counts", async () => {
    const program = createProgram();

    await expect(
      program.parseAsync(["run", "--task", "tasks/task.md", "--candidates", "3abc"], {
        from: "user",
      }),
    ).rejects.toMatchObject({
      code: "commander.invalidArgument",
    });
  });

  it("rejects partially numeric timeouts", async () => {
    const program = createProgram();

    await expect(
      program.parseAsync(["run", "--task", "tasks/task.md", "--timeout-ms", "100ms"], {
        from: "user",
      }),
    ).rejects.toMatchObject({
      code: "commander.invalidArgument",
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
