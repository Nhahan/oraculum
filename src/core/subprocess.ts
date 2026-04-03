import { spawn } from "node:child_process";

import { OraculumError } from "./errors.js";

export interface SubprocessResult {
  durationMs: number;
  exitCode: number;
  signal: NodeJS.Signals | null;
  stderr: string;
  stdout: string;
  timedOut: boolean;
}

interface RunSubprocessOptions {
  args: string[];
  command: string;
  cwd: string;
  env?: NodeJS.ProcessEnv;
  timeoutMs?: number;
}

export async function runSubprocess(options: RunSubprocessOptions): Promise<SubprocessResult> {
  const startedAt = Date.now();

  return new Promise((resolve, reject) => {
    let stdout = "";
    let stderr = "";
    let timedOut = false;

    const child = spawn(options.command, options.args, {
      cwd: options.cwd,
      env: {
        ...process.env,
        ...options.env,
      },
      stdio: ["ignore", "pipe", "pipe"],
    });

    const timeoutId =
      options.timeoutMs && options.timeoutMs > 0
        ? setTimeout(() => {
            timedOut = true;
            child.kill("SIGTERM");

            setTimeout(() => {
              if (!child.killed) {
                child.kill("SIGKILL");
              }
            }, 500).unref();
          }, options.timeoutMs)
        : undefined;

    child.stdout.on("data", (chunk: Buffer | string) => {
      stdout += chunk.toString();
    });

    child.stderr.on("data", (chunk: Buffer | string) => {
      stderr += chunk.toString();
    });

    child.on("error", (error) => {
      if (timeoutId) {
        clearTimeout(timeoutId);
      }

      reject(
        new OraculumError(`Failed to start subprocess "${options.command}": ${error.message}`),
      );
    });

    child.on("close", (code, signal) => {
      if (timeoutId) {
        clearTimeout(timeoutId);
      }

      resolve({
        durationMs: Date.now() - startedAt,
        exitCode: code ?? (timedOut ? 124 : 1),
        signal,
        stderr,
        stdout,
        timedOut,
      });
    });
  });
}
