import { Command } from "commander";

import { registerConsultCommand, registerDraftCommand } from "./commands/consult.js";
import { registerInitCommand } from "./commands/init.js";
import { registerCrownCommand } from "./commands/promote.js";
import { registerVerdictCommand } from "./commands/verdict.js";
import { APP_NAME, APP_VERSION } from "./core/constants.js";

export function buildProgram(): Command {
  const program = new Command();

  program
    .name(APP_NAME)
    .description("Consult competing patches, collect verdicts, and crown only survivors.")
    .version(APP_VERSION);

  registerConsultCommand(program);
  registerDraftCommand(program);
  registerVerdictCommand(program);
  registerCrownCommand(program);
  registerInitCommand(program);

  return program;
}
