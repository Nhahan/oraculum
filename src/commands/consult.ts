import { type Command, InvalidArgumentError } from "commander";

import { type Adapter, adapterSchema } from "../domain/config.js";
import { renderConsultationSummary } from "../services/consultations.js";
import { executeRun } from "../services/execution.js";
import { ensureProjectInitialized } from "../services/project.js";
import { planRun } from "../services/runs.js";

interface ConsultOptions {
  agent?: Adapter;
  candidates?: number;
  timeoutMs?: number;
}

interface DraftOptions {
  agent?: Adapter;
  candidates?: number;
}

export function registerConsultCommand(program: Command): void {
  program
    .command("consult")
    .description(
      "Consult the oracle on one task, auto-select a consultation profile, and run the full tournament.",
    )
    .argument("[task]", "task note path, task packet path, or inline task text")
    .option(
      "-c, --candidates <count>",
      "number of candidate patches to plan",
      parsePositiveInteger("candidate count", { max: 16 }),
    )
    .option("-a, --agent <agent>", "agent runtime to target", parseAdapter)
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
}

export function registerDraftCommand(program: Command): void {
  program
    .command("draft")
    .description("Stage a consultation with auto-selected defaults without executing candidates.")
    .argument("<task>", "task note path, task packet path, or inline task text")
    .option(
      "-c, --candidates <count>",
      "number of candidate patches to plan",
      parsePositiveInteger("candidate count", { max: 16 }),
    )
    .option("-a, --agent <agent>", "agent runtime to target", parseAdapter)
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
  agentInput?: Adapter;
  candidates?: number;
  draftOnly: boolean;
  timeoutMs?: number;
}): Promise<void> {
  const initialized = await ensureProjectInitialized(process.cwd());
  if (initialized) {
    process.stdout.write(`Initialized Oraculum in ${initialized.projectRoot}\n`);
  }

  const manifest = await planRun({
    cwd: process.cwd(),
    taskInput: options.taskInput,
    ...(options.agentInput ? { agent: options.agentInput } : {}),
    ...(options.candidates !== undefined ? { candidates: options.candidates } : {}),
    autoProfile: {
      allowRuntime: !options.draftOnly,
      ...(options.timeoutMs !== undefined ? { timeoutMs: options.timeoutMs } : {}),
    },
  });

  process.stdout.write(
    `Starting consultation ${manifest.id} with ${manifest.candidateCount} candidate${manifest.candidateCount === 1 ? "" : "s"} on ${manifest.agent}.\n`,
  );
  if (options.draftOnly) {
    process.stdout.write(
      "Drafted only. Execution was skipped because the draft command was requested.\n",
    );
    process.stdout.write(await renderConsultationSummary(manifest, process.cwd()));
    return;
  }

  const execution = await executeRun({
    cwd: process.cwd(),
    runId: manifest.id,
    ...(options.timeoutMs !== undefined ? { timeoutMs: options.timeoutMs } : {}),
  });

  process.stdout.write("Consultation complete.\n");
  process.stdout.write(await renderConsultationSummary(execution.manifest, process.cwd()));
}

function parsePositiveInteger(
  label: string,
  options: { max?: number } = {},
): (value: string) => number {
  return (value: string) => {
    const normalized = value.trim();
    if (!/^[1-9]\d*$/u.test(normalized)) {
      throw new InvalidArgumentError(`${label} must be a positive integer.`);
    }

    const parsed = Number(normalized);
    if (!Number.isSafeInteger(parsed) || parsed < 1) {
      throw new InvalidArgumentError(`${label} must be a positive integer.`);
    }
    if (options.max !== undefined && parsed > options.max) {
      throw new InvalidArgumentError(`${label} must be ${options.max} or less.`);
    }

    return parsed;
  };
}

function parseAdapter(value: string): Adapter {
  const parsed = adapterSchema.safeParse(value);
  if (!parsed.success) {
    throw new InvalidArgumentError(`agent must be one of: ${adapterSchema.options.join(", ")}.`);
  }

  return parsed.data;
}
