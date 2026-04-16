import {
  type AdapterExecutionResult,
  createAdapterPaths,
  executeAdapterCommand,
} from "../execution.js";

interface ClaudeInteractionOptions {
  binaryPath: string;
  cwd: string;
  env?: NodeJS.ProcessEnv;
  filenames: {
    prompt: string;
    stderr: string;
    stdout: string;
  };
  jsonSchema?: Record<string, unknown>;
  logDir: string;
  permissionMode: "bypassPermissions" | "plan";
  prompt: string;
  timeoutMs?: number;
}

export interface ClaudeInteractionResult {
  execution: AdapterExecutionResult;
  output: string;
}

export async function executeClaudeInteraction(
  options: ClaudeInteractionOptions,
): Promise<ClaudeInteractionResult> {
  const paths = createAdapterPaths(options.logDir, options.filenames);
  const args = ["-p", "--output-format", "json", "--permission-mode", options.permissionMode];

  if (options.jsonSchema) {
    args.push("--json-schema", JSON.stringify(options.jsonSchema));
  }

  const execution = await executeAdapterCommand({
    args,
    binaryPath: options.binaryPath,
    cwd: options.cwd,
    ...(options.env ? { env: options.env } : {}),
    paths,
    prompt: options.prompt,
    stdoutKind: "stdout",
    ...(options.timeoutMs !== undefined ? { timeoutMs: options.timeoutMs } : {}),
  });

  return {
    execution,
    output: execution.subprocessResult.stdout,
  };
}
