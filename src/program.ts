import { Command } from "commander";

import { registerConsultCommand, registerDraftCommand } from "./commands/consult.js";
import { registerInitCommand } from "./commands/init.js";
import { registerPromoteCommand } from "./commands/promote.js";
import { registerVerdictCommand } from "./commands/verdict.js";
import { APP_NAME, APP_VERSION } from "./core/constants.js";

export function buildProgram(): Command {
  const program = new Command();

  program
    .name(APP_NAME)
    .description("Patch consultation and promotion harness for AI-native development workflows.")
    .version(APP_VERSION);

  registerConsultCommand(program);
  registerDraftCommand(program);
  registerVerdictCommand(program);
  registerPromoteCommand(program);
  registerInitCommand(program);

  return program;
}
