import { spawn } from "node:child_process";

import { OraculumError } from "../../core/errors.js";
import type { HostWrapperTransport, HostWrapperTransportOptions } from "./types.js";

export const directHostWrapperTransport: HostWrapperTransport = {
  id: "direct",
  async run(options: HostWrapperTransportOptions): Promise<number> {
    return await runDirectHostBinary(options.command, options.args, options.cwd, options.env);
  },
};

export async function runDirectHostBinary(
  command: string,
  args: string[],
  cwd = process.cwd(),
  env = process.env,
): Promise<number> {
  return await new Promise<number>((resolve, reject) => {
    const child = spawn(command, args, {
      cwd,
      env,
      stdio: "inherit",
    });

    child.once("error", (error) => {
      reject(new OraculumError(`Failed to launch ${command}: ${error.message}`));
    });
    child.once("exit", (code, signal) => {
      if (signal) {
        process.kill(process.pid, signal);
        return;
      }

      resolve(code ?? 0);
    });
  });
}
