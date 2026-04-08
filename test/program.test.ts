import type { Command } from "commander";
import { describe, expect, it } from "vitest";

import packageJson from "../package.json" with { type: "json" };
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

  it("rejects partially numeric candidate counts for draft", async () => {
    const program = createProgram();

    await expect(
      program.parseAsync(["draft", "tasks/task.md", "--candidates", "3abc"], { from: "user" }),
    ).rejects.toMatchObject({
      code: "commander.invalidArgument",
    });
  });

  it("rejects candidate counts above the supported maximum", async () => {
    const program = createProgram();

    await expect(
      program.parseAsync(["consult", "tasks/task.md", "--candidates", "17"], { from: "user" }),
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

  it("rejects unsupported agents before executing the command", async () => {
    const program = createProgram();

    await expect(
      program.parseAsync(["consult", "tasks/task.md", "--agent", "aider"], { from: "user" }),
    ).rejects.toMatchObject({
      code: "commander.invalidArgument",
    });
  });

  it("rejects promote without a branch name at the CLI boundary", async () => {
    const program = createProgram();

    await expect(program.parseAsync(["promote"], { from: "user" })).rejects.toMatchObject({
      code: "commander.missingMandatoryOptionValue",
    });
  });

  it("uses the package version for CLI version output", () => {
    const program = buildProgram();

    expect(program.version()).toBe(packageJson.version);
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
