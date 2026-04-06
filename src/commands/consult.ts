import { type Command, InvalidArgumentError } from "commander";

import { adapterSchema } from "../domain/config.js";
import { executeRun } from "../services/execution.js";
import { ensureProjectInitialized } from "../services/project.js";
import { planRun } from "../services/runs.js";

interface ConsultOptions {
  agent?: string;
  candidates?: number;
  timeoutMs?: number;
}

interface DraftOptions {
  agent?: string;
  candidates?: number;
}

export function registerConsultCommand(program: Command): void {
  const consult = program
    .command("consult")
    .description("Consult Oraculum on one task and run the full tournament.")
    .argument("[task]", "task note path, task packet path, or inline task text")
    .option(
      "-c, --candidates <count>",
      "number of candidate patches to plan",
      parsePositiveInteger("candidate count"),
    )
    .option("-a, --agent <agent>", "agent runtime to target")
    .option("--timeout-ms <ms>", "adapter timeout in milliseconds", parsePositiveInteger("timeout"))
    .action(async (task: string | undefined, options: ConsultOptions) => {
      if (!task) {
        throw new InvalidArgumentError("task input is required.");
      }

      await runConsultAction({
        taskInput: task,
        ...(options.agent ? { agentInput: options.agent } : {}),
        ...(options.candidates !== undefined ? { candidates: options.candidates } : {}),
        ...(options.timeoutMs !== undefined ? { timeoutMs: options.timeoutMs } : {}),
        draftOnly: false,
      });
    });

  consult
    .command("draft")
    .description("Stage a consultation without executing candidates.")
    .argument("<task>", "task note path, task packet path, or inline task text")
    .option(
      "-c, --candidates <count>",
      "number of candidate patches to plan",
      parsePositiveInteger("candidate count"),
    )
    .option("-a, --agent <agent>", "agent runtime to target")
    .action(async (task: string, options: DraftOptions) => {
      await runConsultAction({
        taskInput: task,
        ...(options.agent ? { agentInput: options.agent } : {}),
        ...(options.candidates !== undefined ? { candidates: options.candidates } : {}),
        draftOnly: true,
      });
    });
}

async function runConsultAction(options: {
  taskInput: string;
  agentInput?: string;
  candidates?: number;
  draftOnly: boolean;
  timeoutMs?: number;
}): Promise<void> {
  const initialized = await ensureProjectInitialized(process.cwd());
  if (initialized) {
    process.stdout.write(`Initialized Oraculum in ${initialized.projectRoot}\n`);
  }

  const agent = options.agentInput ? adapterSchema.parse(options.agentInput) : undefined;
  const manifest = await planRun({
    cwd: process.cwd(),
    taskInput: options.taskInput,
    ...(agent ? { agent } : {}),
    ...(options.candidates !== undefined ? { candidates: options.candidates } : {}),
  });

  process.stdout.write(`Consultation: ${manifest.id}\n`);
  process.stdout.write(`Task: ${manifest.taskPacket.title}\n`);
  process.stdout.write(`Agent: ${manifest.agent}\n`);
  process.stdout.write(`Candidates: ${manifest.candidateCount}\n`);
  if (options.draftOnly) {
    process.stdout.write(
      "Drafted only. Execution was skipped because consult draft was requested.\n",
    );
    process.stdout.write(`Artifacts: .oraculum/runs/${manifest.id}\n`);
    return;
  }

  const execution = await executeRun({
    cwd: process.cwd(),
    runId: manifest.id,
    ...(options.timeoutMs !== undefined ? { timeoutMs: options.timeoutMs } : {}),
  });

  process.stdout.write("Execution results:\n");
  for (const result of execution.candidateResults) {
    process.stdout.write(`- ${result.candidateId}: ${result.status} (exit ${result.exitCode})\n`);
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
  if (execution.manifest.recommendedWinner) {
    process.stdout.write(
      `Recommended promotion: ${execution.manifest.recommendedWinner.candidateId} (${execution.manifest.recommendedWinner.confidence}, ${execution.manifest.recommendedWinner.source})\n`,
    );
    process.stdout.write(`${execution.manifest.recommendedWinner.summary}\n`);
    process.stdout.write(
      `Comparison report: .oraculum/runs/${manifest.id}/reports/comparison.md\n`,
    );
    process.stdout.write("Promote next: oraculum promote --branch <branch-name>\n");
  } else {
    process.stdout.write(
      "No recommended promotion was selected automatically. Inspect the consultation with `oraculum verdict` and choose a candidate with `oraculum promote <candidate-id> --branch <branch-name>` if needed.\n",
    );
  }
  process.stdout.write(`Artifacts: .oraculum/runs/${manifest.id}\n`);
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
