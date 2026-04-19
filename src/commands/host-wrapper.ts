import { type Command, InvalidArgumentError } from "commander";

import type { Adapter } from "../domain/config.js";
import { runHostWrapper } from "../services/host-wrapper.js";

export function registerHostWrapperCommand(program: Command): void {
  program
    .command("host-wrapper")
    .argument("<runtime>", "host runtime", parseRuntime)
    .argument("[forwardedArgs...]", "arguments forwarded to the wrapped host binary")
    .allowUnknownOption(true)
    .allowExcessArguments(true)
    .description("Internal host wrapper for shell-installed `codex` / `claude` passthrough.")
    .action(async (runtime: Adapter, forwardedArgs: string[]) => {
      process.exitCode = await runHostWrapper({
        host: runtime,
        args: forwardedArgs,
      });
    });
}

function parseRuntime(value: string): Adapter {
  if (value !== "claude-code" && value !== "codex") {
    throw new InvalidArgumentError('runtime must be one of: "claude-code", "codex".');
  }

  return value;
}
