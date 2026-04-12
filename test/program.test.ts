import type { Command } from "commander";
import { describe, expect, it } from "vitest";

import packageJson from "../package.json" with { type: "json" };
import { buildProgram } from "../src/program.js";

describe("CLI argument parsing", () => {
  it("rejects unsupported setup runtimes before executing the command", async () => {
    const program = createProgram();

    await expect(
      program.parseAsync(["setup", "--runtime", "aider"], { from: "user" }),
    ).rejects.toMatchObject({
      code: "commander.invalidArgument",
    });
  });

  it("rejects unsupported uninstall runtimes before executing the command", async () => {
    const program = createProgram();

    await expect(
      program.parseAsync(["uninstall", "--runtime", "aider"], { from: "user" }),
    ).rejects.toMatchObject({
      code: "commander.invalidArgument",
    });
  });

  it("rejects legacy setup scope flags", async () => {
    const program = createProgram();

    await expect(
      program.parseAsync(["setup", "--runtime", "claude-code", "--scope", "global"], {
        from: "user",
      }),
    ).rejects.toMatchObject({
      code: "commander.unknownOption",
    });
  });

  it("rejects setup without a runtime while still allowing setup subcommands", async () => {
    const program = createProgram();

    await expect(program.parseAsync(["setup"], { from: "user" })).rejects.toThrow(
      'setup requires "--runtime <claude-code|codex>" unless a subcommand is used.',
    );
    await expect(program.parseAsync(["setup", "status"], { from: "user" })).resolves.toBeTruthy();
  });

  it("does not expose shell workflow commands anymore", async () => {
    const program = createProgram();

    await expect(program.parseAsync(["consult"], { from: "user" })).rejects.toMatchObject({
      code: "commander.unknownCommand",
    });
    await expect(program.parseAsync(["verdict"], { from: "user" })).rejects.toMatchObject({
      code: "commander.unknownCommand",
    });
    await expect(program.parseAsync(["crown"], { from: "user" })).rejects.toMatchObject({
      code: "commander.unknownCommand",
    });
    await expect(program.parseAsync(["draft"], { from: "user" })).rejects.toMatchObject({
      code: "commander.unknownCommand",
    });
    await expect(program.parseAsync(["init"], { from: "user" })).rejects.toMatchObject({
      code: "commander.unknownCommand",
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
