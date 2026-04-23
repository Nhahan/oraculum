import { Command } from "commander";

import { registerHostWrapperCommand } from "./commands/host-wrapper.js";
import { registerOrcCommand } from "./commands/orc.js";
import { registerSetupCommand } from "./commands/setup.js";
import { APP_NAME, APP_VERSION } from "./core/constants.js";

export function buildProgram(): Command {
  const program = new Command();

  program
    .name(APP_NAME)
    .description("Set up Oraculum host integration and run direct host-native commands.")
    .version(APP_VERSION);

  registerSetupCommand(program);
  registerOrcCommand(program);
  registerHostWrapperCommand(program);

  return program;
}
