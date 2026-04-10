import { spawn } from "node:child_process";

import { OraculumError } from "./errors.js";

export interface SubprocessResult {
  durationMs: number;
  exitCode: number;
  signal: NodeJS.Signals | null;
  stderr: string;
  stderrTruncated: boolean;
  stdout: string;
  stdoutTruncated: boolean;
  timedOut: boolean;
}

interface RunSubprocessOptions {
  args: string[];
  command: string;
  cwd: string;
  env?: NodeJS.ProcessEnv;
  maxOutputBytes?: number;
  shell?: boolean | string;
  stdin?: string;
  timeoutMs?: number;
}

export async function runSubprocess(options: RunSubprocessOptions): Promise<SubprocessResult> {
  const startedAt = Date.now();
  const shell =
    options.shell ?? (process.platform === "win32" && /\.(cmd|bat)$/iu.test(options.command));
  const maxOutputBytes = options.maxOutputBytes ?? 10 * 1024 * 1024;

  return new Promise((resolve, reject) => {
    let stdout = "";
    let stderr = "";
    let stdoutBytes = 0;
    let stderrBytes = 0;
    let stdoutTruncated = false;
    let stderrTruncated = false;
    let closed = false;
    let timedOut = false;

    const child = spawn(options.command, options.args, {
      cwd: options.cwd,
      env: {
        ...process.env,
        ...options.env,
      },
      detached: process.platform !== "win32",
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
      const appended = appendBoundedOutput({
        chunk,
        current: stdout,
        currentBytes: stdoutBytes,
        maxOutputBytes,
      });
      stdout = appended.output;
      stdoutBytes = appended.bytes;
      stdoutTruncated ||= appended.truncated;
    });

    child.stderr.on("data", (chunk: Buffer | string) => {
      const appended = appendBoundedOutput({
        chunk,
        current: stderr,
        currentBytes: stderrBytes,
        maxOutputBytes,
      });
      stderr = appended.output;
      stderrBytes = appended.bytes;
      stderrTruncated ||= appended.truncated;
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
        stderrTruncated,
        stdout,
        stdoutTruncated,
        timedOut,
      });
    });
  });
}

function appendBoundedOutput(options: {
  chunk: Buffer | string;
  current: string;
  currentBytes: number;
  maxOutputBytes: number;
}): { bytes: number; output: string; truncated: boolean } {
  if (options.maxOutputBytes <= 0 || options.currentBytes >= options.maxOutputBytes) {
    return {
      bytes: Math.max(0, options.maxOutputBytes),
      output: options.current,
      truncated: true,
    };
  }

  const chunk = Buffer.isBuffer(options.chunk)
    ? options.chunk
    : Buffer.from(options.chunk.toString());
  const remainingBytes = options.maxOutputBytes - options.currentBytes;
  if (chunk.byteLength <= remainingBytes) {
    return {
      bytes: options.currentBytes + chunk.byteLength,
      output: options.current + chunk.toString(),
      truncated: false,
    };
  }

  return {
    bytes: options.maxOutputBytes,
    output: options.current + chunk.subarray(0, remainingBytes).toString(),
    truncated: true,
  };
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

  const signal = force ? "SIGKILL" : "SIGTERM";
  if (child.pid) {
    try {
      process.kill(-child.pid, signal);
      return;
    } catch {
      // Fall through to direct child termination if the process group is unavailable.
    }
  }
  child.kill(signal);
}
