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
  shell?: boolean | string;
  stdin?: string;
  timeoutMs?: number;
}

export async function runSubprocess(options: RunSubprocessOptions): Promise<SubprocessResult> {
  const startedAt = Date.now();
  const shell =
    options.shell ?? (process.platform === "win32" && /\.(cmd|bat)$/iu.test(options.command));

  return new Promise((resolve, reject) => {
    let stdout = "";
    let stderr = "";
    let closed = false;
    let timedOut = false;

    const child = spawn(options.command, options.args, {
      cwd: options.cwd,
      env: {
        ...process.env,
        ...options.env,
      },
      ...(shell !== undefined ? { shell } : {}),
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true,
    });

    let killTimeoutId: NodeJS.Timeout | undefined;
    const timeoutId =
      options.timeoutMs && options.timeoutMs > 0
        ? setTimeout(() => {
            timedOut = true;
            terminateChild(child, false);

            killTimeoutId = setTimeout(() => {
              if (!closed) {
                terminateChild(child, true);
              }
            }, 500).unref();
          }, options.timeoutMs)
        : undefined;

    if (child.stdin) {
      child.stdin.on("error", () => {
        // Ignore stdin stream errors when the child exits before consuming input.
      });

      if (options.stdin !== undefined) {
        child.stdin.end(options.stdin);
      } else {
        child.stdin.end();
      }
    }

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
      if (killTimeoutId) {
        clearTimeout(killTimeoutId);
      }

      reject(
        new OraculumError(`Failed to start subprocess "${options.command}": ${error.message}`),
      );
    });

    child.on("close", (code, signal) => {
      closed = true;
      if (timeoutId) {
        clearTimeout(timeoutId);
      }
      if (killTimeoutId) {
        clearTimeout(killTimeoutId);
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

function terminateChild(child: ReturnType<typeof spawn>, force: boolean): void {
  if (process.platform === "win32") {
    const pid = child.pid;
    if (!pid) {
      return;
    }

    const args = ["/pid", String(pid), "/T"];
    if (force) {
      args.push("/F");
    }

    const killer = spawn("taskkill", args, {
      stdio: "ignore",
      windowsHide: true,
    });
    killer.on("error", () => {
      child.kill(force ? "SIGKILL" : "SIGTERM");
    });
    return;
  }

  child.kill(force ? "SIGKILL" : "SIGTERM");
}
