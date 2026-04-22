import { join } from "node:path";

import { type AgentRunResult, agentRunResultSchema } from "../../adapters/types.js";
import { runSubprocess } from "../../core/subprocess.js";
import { writeTextFileAtomically } from "../project.js";

interface MaterializeExecutionFailureOptions {
  adapter: AgentRunResult["adapter"];
  candidateId: string;
  error: unknown;
  logDir: string;
  runId: string;
}

export async function materializeExecutionFailure(
  options: MaterializeExecutionFailureOptions,
): Promise<AgentRunResult> {
  const errorMessage =
    options.error instanceof Error ? options.error.message : String(options.error);
  const errorPath = join(options.logDir, "execution-error.txt");
  const timestamp = new Date().toISOString();

  await writeTextFileAtomically(errorPath, `${errorMessage}\n`);

  return agentRunResultSchema.parse({
    runId: options.runId,
    candidateId: options.candidateId,
    adapter: options.adapter,
    status: "failed",
    startedAt: timestamp,
    completedAt: timestamp,
    exitCode: 1,
    summary: errorMessage,
    artifacts: [{ kind: "log", path: errorPath }],
  });
}

export async function readProjectRevision(projectRoot: string): Promise<string> {
  const result = await runSubprocess({
    command: "git",
    args: ["rev-parse", "HEAD"],
    cwd: projectRoot,
    timeoutMs: 15_000,
  });
  if (result.exitCode !== 0 || !result.stdout.trim()) {
    throw new Error(`Failed to read project revision in ${projectRoot}.`);
  }

  return result.stdout.trim();
}
