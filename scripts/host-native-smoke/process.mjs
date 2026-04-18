import { spawn } from "node:child_process";

export function runCommand(command, args, options) {
  return new Promise((resolve, reject) => {
    let stdout = "";
    let stderr = "";
    let closed = false;
    let settled = false;
    let timedOut = false;
    const child = spawn(command, args, {
      cwd: options.cwd,
      env: options.env ?? process.env,
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    });

    const timeoutId = setTimeout(() => {
      if (!closed) {
        timedOut = true;
        terminateChild(child);
      }
    }, options.timeoutMs).unref();

    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
      if (!settled && options.completeWhen?.(stdout, stderr)) {
        settled = true;
        clearTimeout(timeoutId);
        terminateChild(child);
        resolve({ stdout, stderr });
      }
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
      if (!settled && options.completeWhen?.(stdout, stderr)) {
        settled = true;
        clearTimeout(timeoutId);
        terminateChild(child);
        resolve({ stdout, stderr });
      }
    });
    child.on("error", (error) => {
      clearTimeout(timeoutId);
      if (settled) {
        return;
      }
      settled = true;
      reject(new Error(`Failed to start ${options.label}: ${error.message}`));
    });
    child.on("close", (code, signal) => {
      closed = true;
      clearTimeout(timeoutId);
      if (settled) {
        return;
      }
      settled = true;
      if (code !== 0) {
        reject(
          new Error(
            [
              `Command failed: ${options.label}`,
              `exitCode=${code ?? "null"} signal=${signal ?? "null"}`,
              timedOut ? `timedOut=true timeoutMs=${options.timeoutMs}` : "",
              stdout ? `stdout:\n${stdout}` : "",
              stderr ? `stderr:\n${stderr}` : "",
            ]
              .filter(Boolean)
              .join("\n\n"),
          ),
        );
        return;
      }

      resolve({ stdout, stderr });
    });
  });
}

export function isClaudeStreamJsonComplete(stdout, _stderr) {
  for (const line of stdout.split(/\r?\n/u)) {
    const trimmed = line.trim();
    if (!trimmed.startsWith("{")) {
      continue;
    }

    try {
      const parsed = JSON.parse(trimmed);
      if (parsed?.type === "result") {
        return true;
      }
    } catch {
      // Ignore mixed plain-text diagnostics while scanning for the terminal JSON event.
    }
  }

  return false;
}

function terminateChild(child) {
  if (process.platform === "win32") {
    const pid = child.pid;
    if (!pid) {
      return;
    }
    spawn("taskkill", ["/pid", String(pid), "/T", "/F"], {
      stdio: "ignore",
      windowsHide: true,
    });
    return;
  }

  child.kill("SIGTERM");
  setTimeout(() => {
    if (child.exitCode === null) {
      child.kill("SIGKILL");
    }
  }, 500).unref();
}
