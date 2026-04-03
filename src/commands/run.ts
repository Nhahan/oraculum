import type { Command } from "commander";

import { adapterSchema } from "../domain/config.js";
import { planRun } from "../services/runs.js";

export function registerRunCommand(program: Command): void {
  program
    .command("run")
    .description("Create a planned run manifest and candidate workspace scaffold.")
    .requiredOption("-t, --task <path>", "task packet or task note path")
    .option("-c, --candidates <count>", "number of candidate patches to plan", parseInteger)
    .option("-a, --agent <agent>", "agent runtime to target")
    .action(async (options: { agent?: string; candidates?: number; task: string }) => {
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
      process.stdout.write(
        "Execution is not implemented yet; this command currently creates the run artifact layout.\n",
      );
    });
}

function parseInteger(value: string): number {
  return Number.parseInt(value, 10);
}
