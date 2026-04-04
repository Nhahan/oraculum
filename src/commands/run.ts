import { type Command, InvalidArgumentError } from "commander";

import { adapterSchema } from "../domain/config.js";
import { executeRun } from "../services/execution.js";
import { planRun } from "../services/runs.js";

export function registerRunCommand(program: Command): void {
  program
    .command("run")
    .description("Plan, execute, and judge a full Oraculum run.")
    .requiredOption("-t, --task <path>", "task packet or task note path")
    .option(
      "-c, --candidates <count>",
      "number of candidate patches to plan",
      parsePositiveInteger("candidate count"),
    )
    .option("-a, --agent <agent>", "agent runtime to target")
    .option("--plan-only", "only scaffold the run without executing it", false)
    .option("--timeout-ms <ms>", "adapter timeout in milliseconds", parsePositiveInteger("timeout"))
    .action(
      async (options: {
        agent?: string;
        candidates?: number;
        planOnly?: boolean;
        task: string;
        timeoutMs?: number;
      }) => {
        const agent = options.agent ? adapterSchema.parse(options.agent) : undefined;
        const manifest = await planRun({
          cwd: process.cwd(),
          taskPath: options.task,
          ...(agent ? { agent } : {}),
          ...(options.candidates !== undefined ? { candidates: options.candidates } : {}),
        });

        process.stdout.write(`Planned run: ${manifest.id}\n`);
        process.stdout.write(`Task: ${manifest.taskPath}\n`);
        process.stdout.write(`Agent: ${manifest.agent}\n`);
        process.stdout.write(`Candidates: ${manifest.candidateCount}\n`);
        process.stdout.write("Scaffolded candidates:\n");
        for (const candidate of manifest.candidates) {
          process.stdout.write(`- ${candidate.id}: ${candidate.strategyLabel}\n`);
        }
        if (options.planOnly ?? false) {
          process.stdout.write("Execution was skipped because --plan-only was requested.\n");
          return;
        }

        const execution = await executeRun({
          cwd: process.cwd(),
          runId: manifest.id,
          ...(options.timeoutMs !== undefined ? { timeoutMs: options.timeoutMs } : {}),
        });

        process.stdout.write("Execution results:\n");
        for (const result of execution.candidateResults) {
          process.stdout.write(
            `- ${result.candidateId}: ${result.status} (exit ${result.exitCode})\n`,
          );
        }

        const finalists = execution.manifest.candidates.filter(
          (candidate) => candidate.status === "promoted",
        );
        process.stdout.write(`Promoted finalists: ${finalists.length}\n`);
        if (finalists.length > 0) {
          for (const finalist of finalists) {
            process.stdout.write(`  - ${finalist.id}: ${finalist.strategyLabel}\n`);
          }
        }
      },
    );
}

function parsePositiveInteger(label: string): (value: string) => number {
  return (value: string) => {
    const normalized = value.trim();
    if (!/^[1-9]\d*$/u.test(normalized)) {
      throw new InvalidArgumentError(`${label} must be a positive integer.`);
    }

    const parsed = Number(normalized);
    if (!Number.isSafeInteger(parsed) || parsed < 1) {
      throw new InvalidArgumentError(`${label} must be a positive integer.`);
    }

    return parsed;
  };
}
