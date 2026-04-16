import {
  type AdapterExecutionResult,
  createAdapterPaths,
  executeAdapterCommand,
} from "../execution.js";
import type { AgentArtifact } from "../types.js";

interface CodexInteractionOptions {
  binaryPath: string;
  cwd: string;
  env?: NodeJS.ProcessEnv;
  filenames: {
    finalMessage: string;
    prompt: string;
    schema?: string;
    stderr: string;
    stdout: string;
  };
  logDir: string;
  outputSchema?: Record<string, unknown>;
  prompt: string;
  sandboxMode: "read-only" | "workspace-write";
  timeoutMs?: number;
}

export interface CodexInteractionResult {
  execution: AdapterExecutionResult;
  output: string;
}

export async function executeCodexInteraction(
  options: CodexInteractionOptions,
): Promise<CodexInteractionResult> {
  const paths = createCodexPaths(options.logDir, options.filenames);
  const args = [
    "-a",
    "never",
    "exec",
    "-s",
    options.sandboxMode,
    "--skip-git-repo-check",
    "--json",
  ];

  if (paths.schema) {
    args.push("--output-schema", paths.schema);
  }

  args.push("-o", paths.finalMessage);

  const sidecarWrites: Array<{ content: string; kind: AgentArtifact["kind"]; path: string }> = [];
  if (paths.schema && options.outputSchema) {
    sidecarWrites.push({
      kind: "report",
      path: paths.schema,
      content: `${JSON.stringify(options.outputSchema, null, 2)}\n`,
    });
  }

  const execution = await executeAdapterCommand({
    args,
    binaryPath: options.binaryPath,
    cwd: options.cwd,
    ...(options.env ? { env: options.env } : {}),
    paths,
    prompt: options.prompt,
    readOptionalArtifacts: [{ kind: "report", path: paths.finalMessage }],
    ...(sidecarWrites.length > 0 ? { sidecarWrites } : {}),
    stdoutKind: "transcript",
    ...(options.timeoutMs !== undefined ? { timeoutMs: options.timeoutMs } : {}),
  });

  const finalMessage = execution.optionalArtifactContents.get(paths.finalMessage);

  return {
    execution,
    output: finalMessage ?? execution.subprocessResult.stdout,
  };
}

function createCodexPaths(
  logDir: string,
  filenames: CodexInteractionOptions["filenames"],
): {
  finalMessage: string;
  prompt: string;
  schema?: string;
  stderr: string;
  stdout: string;
} {
  const paths = createAdapterPaths(logDir, {
    finalMessage: filenames.finalMessage,
    prompt: filenames.prompt,
    stderr: filenames.stderr,
    stdout: filenames.stdout,
    ...(filenames.schema ? { schema: filenames.schema } : {}),
  });

  return {
    finalMessage: paths.finalMessage,
    prompt: paths.prompt,
    ...(paths.schema ? { schema: paths.schema } : {}),
    stderr: paths.stderr,
    stdout: paths.stdout,
  };
}
