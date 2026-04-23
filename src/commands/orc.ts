import { isAbsolute, relative } from "node:path";

import { type Command, InvalidArgumentError } from "commander";

import { resolveProjectRoot } from "../core/paths.js";
import type { CrownActionResponse } from "../domain/chat-native.js";
import {
  runConsultAction,
  runCrownAction,
  runPlanAction,
  runVerdictAction,
} from "../services/orc-actions.js";

interface JsonOption {
  json?: boolean;
}

interface CrownOptions extends JsonOption {
  allowUnsafe?: boolean;
}

export function registerOrcCommand(program: Command): void {
  const orc = program
    .command("orc")
    .description("Run host-native Oraculum workflow commands directly.");

  orc
    .command("consult")
    .argument("[taskInput...]", "inline task text, task note path, or task packet path")
    .option("--json", "emit machine-readable JSON")
    .action(async (taskInput: string[] | undefined, options: JsonOption) => {
      const resolvedTaskInput = joinOptionalTaskInput(taskInput);
      await printResponse(
        await runConsultAction({
          cwd: process.cwd(),
          ...(resolvedTaskInput ? { taskInput: resolvedTaskInput } : {}),
        }),
        options,
      );
    });

  orc
    .command("plan")
    .argument("<taskInput...>", "inline task text, task note path, or task packet path")
    .option("--json", "emit machine-readable JSON")
    .action(async (taskInput: string[], options: JsonOption) => {
      await printResponse(
        await runPlanAction({
          cwd: process.cwd(),
          taskInput: joinTaskInput(taskInput),
        }),
        options,
      );
    });

  orc
    .command("verdict")
    .argument("[consultationId]", "optional consultation id")
    .option("--json", "emit machine-readable JSON")
    .action(async (consultationId: string | undefined, options: JsonOption) => {
      await printResponse(
        await runVerdictAction({
          cwd: process.cwd(),
          ...(consultationId ? { consultationId } : {}),
        }),
        options,
      );
    });

  orc
    .command("crown")
    .argument("[materializationName]", "branch name or optional workspace-sync label")
    .option("--allow-unsafe", "explicitly bypass crown safety blockers")
    .option("--json", "emit machine-readable JSON")
    .action(async (materializationName: string | undefined, options: CrownOptions) => {
      await printResponse(
        await runCrownAction({
          cwd: process.cwd(),
          withReport: false,
          ...(materializationName ? { materializationName } : {}),
          ...(options.allowUnsafe ? { allowUnsafe: true } : {}),
        }),
        options,
      );
    });
}

function joinTaskInput(values: string[]): string {
  const taskInput = values.join(" ").trim();
  if (!taskInput) {
    throw new InvalidArgumentError("taskInput is required.");
  }
  return taskInput;
}

function joinOptionalTaskInput(values: string[] | undefined): string | undefined {
  if (!values || values.length === 0) {
    return undefined;
  }

  const taskInput = values.join(" ").trim();
  return taskInput.length > 0 ? taskInput : undefined;
}

async function printResponse(response: unknown, options: JsonOption): Promise<void> {
  if (options.json) {
    process.stdout.write(`${JSON.stringify(response, null, 2)}\n`);
    return;
  }

  if (isSummaryResponse(response)) {
    const summary = isPlanningResponse(response)
      ? `${response.summary.replace(/\s+$/u, "")}\n${renderPlanningContinuationTail(response)}\n`
      : `${response.summary}\n`;
    process.stdout.write(summary);
    return;
  }

  if (isCrownResponse(response)) {
    process.stdout.write(`${renderCrownResponse(response)}\n`);
    return;
  }

  process.stdout.write(`${JSON.stringify(response, null, 2)}\n`);
}

function isSummaryResponse(value: unknown): value is { summary: string } {
  return Boolean(
    value &&
      typeof value === "object" &&
      "summary" in value &&
      typeof (value as { summary?: unknown }).summary === "string",
  );
}

function isCrownResponse(value: unknown): value is CrownActionResponse {
  return Boolean(
    value &&
      typeof value === "object" &&
      (value as { mode?: unknown }).mode === "crown" &&
      "materialization" in value,
  );
}

function isPlanningResponse(value: unknown): value is {
  mode: "plan";
  artifacts: { consultationPlanPath?: string };
  summary: string;
} {
  return Boolean(
    value &&
      typeof value === "object" &&
      (value as { mode?: unknown }).mode === "plan" &&
      typeof (value as { summary?: unknown }).summary === "string" &&
      typeof (value as { artifacts?: { consultationPlanPath?: unknown } }).artifacts
        ?.consultationPlanPath === "string",
  );
}

function renderCrownResponse(response: CrownActionResponse): string {
  const materializedResultSummary = response.plan.winnerId
    ? "The recommended result has already been materialized; do not materialize it again."
    : "The selected finalist has already been materialized; do not materialize it again.";

  return [
    `Crowned ${response.plan.winnerId}`,
    `Consultation: ${response.plan.runId}`,
    ...(response.plan.mode === "git-branch" && response.plan.branchName
      ? [`Branch: ${response.plan.branchName}`]
      : []),
    ...(response.materialization.materializationLabel
      ? [`Label: ${response.materialization.materializationLabel}`]
      : []),
    ...(response.materialization.currentBranch
      ? [`Current branch: ${response.materialization.currentBranch}`]
      : []),
    `Changed paths: ${response.materialization.changedPathCount}`,
    `Post-checks: ${response.materialization.checks.length} passed`,
    materializedResultSummary,
    `Crowning record: ${response.recordPath}`,
  ].join("\n");
}

function renderPlanningContinuationTail(response: {
  artifacts: { consultationPlanPath?: string };
}): string {
  const planPath = response.artifacts.consultationPlanPath;
  if (!planPath) {
    return "";
  }

  const displayPath = toDisplayPath(resolveProjectRoot(process.cwd()), planPath);
  return [
    `Plan path: ${displayPath}`,
    `Next: run \`orc consult ${displayPath}\` to continue this plan.`,
  ].join("\n");
}

function toDisplayPath(projectRoot: string, targetPath: string): string {
  if (!isAbsolute(targetPath)) {
    return targetPath.replaceAll("\\", "/");
  }

  const display = relative(projectRoot, targetPath).replaceAll("\\", "/");
  if (display.length === 0) {
    return ".";
  }

  if (display === ".." || display.startsWith("../") || isAbsolute(display)) {
    return targetPath.replaceAll("\\", "/");
  }

  return display;
}
