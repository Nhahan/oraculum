import { readFile } from "node:fs/promises";
import { join } from "node:path";

import { runSubprocess, type SubprocessResult } from "../core/subprocess.js";
import { writeTextFileAtomically } from "../services/project.js";

import { shouldUseWindowsShell } from "./platform.js";
import type { AgentArtifact } from "./types.js";

export interface AdapterExecutionPaths {
  prompt: string;
  stdout: string;
  stderr: string;
  [key: string]: string;
}

interface AdapterSidecarWrite {
  kind: AgentArtifact["kind"];
  path: string;
  content: string;
}

interface OptionalAdapterArtifact {
  kind: AgentArtifact["kind"];
  path: string;
}

interface ExecuteAdapterCommandOptions {
  args: string[];
  binaryPath: string;
  cwd: string;
  env?: NodeJS.ProcessEnv;
  paths: AdapterExecutionPaths;
  prompt: string;
  readOptionalArtifacts?: OptionalAdapterArtifact[];
  sidecarWrites?: AdapterSidecarWrite[];
  stdoutKind: Extract<AgentArtifact["kind"], "stdout" | "transcript">;
  timeoutMs?: number;
}

export interface AdapterExecutionResult {
  artifacts: AgentArtifact[];
  completedAt: string;
  optionalArtifactContents: Map<string, string>;
  startedAt: string;
  status: "completed" | "failed" | "timed-out";
  subprocessResult: SubprocessResult;
}

export function createAdapterPaths<Names extends Record<string, string>>(
  logDir: string,
  filenames: Names,
): { [Key in keyof Names]: string } {
  return Object.fromEntries(
    Object.entries(filenames).map(([key, filename]) => [key, join(logDir, filename)]),
  ) as { [Key in keyof Names]: string };
}

export async function executeAdapterCommand(
  options: ExecuteAdapterCommandOptions,
): Promise<AdapterExecutionResult> {
  const startedAt = new Date().toISOString();
  const sidecarWrites = options.sidecarWrites ?? [];

  await Promise.all([
    writeTextFileAtomically(options.paths.prompt, options.prompt),
    ...sidecarWrites.map((artifact) => writeTextFileAtomically(artifact.path, artifact.content)),
  ]);

  const subprocessResult = await runSubprocess({
    command: options.binaryPath,
    args: options.args,
    cwd: options.cwd,
    ...(options.env ? { env: options.env } : {}),
    ...(shouldUseWindowsShell(options.binaryPath) ? { shell: true } : {}),
    stdin: options.prompt,
    ...(options.timeoutMs !== undefined ? { timeoutMs: options.timeoutMs } : {}),
  });

  await Promise.all([
    writeTextFileAtomically(options.paths.stdout, subprocessResult.stdout),
    writeTextFileAtomically(options.paths.stderr, subprocessResult.stderr),
  ]);

  const optionalArtifacts = (
    await Promise.all(
      (options.readOptionalArtifacts ?? []).map(async (artifact) => {
        const content = await readOptionalFile(artifact.path);
        if (content === undefined) {
          return undefined;
        }

        return {
          ...artifact,
          content,
        };
      }),
    )
  ).filter((artifact) => artifact !== undefined);

  return {
    artifacts: [
      { kind: "prompt", path: options.paths.prompt },
      ...sidecarWrites.map(({ kind, path }) => ({ kind, path })),
      { kind: options.stdoutKind, path: options.paths.stdout },
      { kind: "stderr", path: options.paths.stderr },
      ...optionalArtifacts.map(({ kind, path }) => ({ kind, path })),
    ],
    completedAt: new Date().toISOString(),
    optionalArtifactContents: new Map(
      optionalArtifacts.map(({ path, content }) => [path, content]),
    ),
    startedAt,
    status: toAgentRunStatus(subprocessResult),
    subprocessResult,
  };
}

export function buildAdapterResultBase(result: AdapterExecutionResult) {
  return {
    artifacts: result.artifacts,
    completedAt: result.completedAt,
    exitCode: result.subprocessResult.exitCode,
    startedAt: result.startedAt,
    status: result.status,
  };
}

async function readOptionalFile(path: string): Promise<string | undefined> {
  try {
    return await readFile(path, "utf8");
  } catch {
    return undefined;
  }
}

function toAgentRunStatus(result: SubprocessResult): AdapterExecutionResult["status"] {
  if (result.timedOut) {
    return "timed-out";
  }

  return result.exitCode === 0 ? "completed" : "failed";
}
