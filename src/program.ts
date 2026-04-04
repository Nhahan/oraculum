import { Command } from "commander";

import { registerExportCommand } from "./commands/export.js";
import { registerInitCommand } from "./commands/init.js";
import { registerRunCommand } from "./commands/run.js";
import { registerShowCommand } from "./commands/show.js";
import { APP_NAME, APP_VERSION } from "./core/constants.js";

export function buildProgram(): Command {
  const program = new Command();

  program
    .name(APP_NAME)
    .description("Patch search and judgment harness for Claude Code and Codex.")
    .version(APP_VERSION);

  registerInitCommand(program);
  registerRunCommand(program);
  registerShowCommand(program);
  registerExportCommand(program);

  return program;
}
