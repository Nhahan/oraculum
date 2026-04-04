import { type Command, InvalidArgumentError } from "commander";

import { adapterSchema } from "../domain/config.js";
import { executeRun } from "../services/execution.js";
import { ensureProjectInitialized } from "../services/project.js";
import { planRun } from "../services/runs.js";

export function registerRunCommand(program: Command): void {
  program
    .command("run")
    .description("Plan, execute, and judge a full Oraculum run.")
    .argument("<task>", "task note path, task packet path, or inline task text")
    .option(
      "-c, --candidates <count>",
      "number of candidate patches to plan",
      parsePositiveInteger("candidate count"),
    )
    .option("-a, --agent <agent>", "agent runtime to target")
    .option("-t, --task <path>", "legacy task option; prefer positional task input")
    .option("--plan-only", "only scaffold the run without executing it", false)
    .option("--timeout-ms <ms>", "adapter timeout in milliseconds", parsePositiveInteger("timeout"))
    .action(
      async (
        task: string | undefined,
        options: {
          agent?: string;
          candidates?: number;
          planOnly?: boolean;
          task?: string;
          timeoutMs?: number;
        },
      ) => {
        const taskInput = task ?? options.task;
        if (!taskInput) {
          throw new InvalidArgumentError("task input is required.");
        }

        const initialized = await ensureProjectInitialized(process.cwd());
        if (initialized) {
          process.stdout.write(`Initialized Oraculum in ${initialized.projectRoot}\n`);
        }

        const agent = options.agent ? adapterSchema.parse(options.agent) : undefined;
        const manifest = await planRun({
          cwd: process.cwd(),
          taskInput,
          ...(agent ? { agent } : {}),
          ...(options.candidates !== undefined ? { candidates: options.candidates } : {}),
        });

        process.stdout.write(`Run: ${manifest.id}\n`);
        process.stdout.write(`Task: ${manifest.taskPacket.title}\n`);
        process.stdout.write(`Agent: ${manifest.agent}\n`);
        process.stdout.write(`Candidates: ${manifest.candidateCount}\n`);
        if (options.planOnly ?? false) {
          process.stdout.write(
            "Planned only. Execution was skipped because --plan-only was requested.\n",
          );
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
        process.stdout.write(`Finalists: ${finalists.length}\n`);
        if (finalists.length > 0) {
          for (const finalist of finalists) {
            process.stdout.write(`  - ${finalist.id}: ${finalist.strategyLabel}\n`);
          }
        }
        process.stdout.write(`Artifacts: .oraculum/runs/${manifest.id}\n`);
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
