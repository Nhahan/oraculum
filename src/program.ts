import { Command } from "commander";

import { registerMcpCommand } from "./commands/mcp.js";
import { registerSetupCommand } from "./commands/setup.js";
import { APP_NAME, APP_VERSION } from "./core/constants.js";

export function buildProgram(): Command {
  const program = new Command();

  program
    .name(APP_NAME)
    .description("Set up or remove Oraculum host integration and run internal MCP services.")
    .version(APP_VERSION);

  registerSetupCommand(program);
  registerMcpCommand(program);

  return program;
}
