import { existsSync, realpathSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import { basename, delimiter, isAbsolute, relative, resolve } from "node:path";

import { runSubprocess } from "../../core/subprocess.js";
import type { OracleEnforcement, RepoOracle } from "../../domain/config.js";
import { type OracleVerdict, oracleVerdictSchema, witnessSchema } from "../../domain/oracle.js";
import {
  collectOracleLocalToolPaths,
  resolveRepoLocalEntrypointCommand,
  resolveRepoLocalWrapperCommand,
} from "../oracle-local-tools.js";
import { writeTextFileAtomically } from "../project.js";
import { RunStore } from "../run-store.js";
import type { EvaluateCandidateRoundOptions, OracleEvaluation } from "./shared.js";

export async function evaluateRepoOracle(
  options: EvaluateCandidateRoundOptions,
  oracle: RepoOracle,
): Promise<OracleEvaluation> {
  const store = new RunStore(options.projectRoot);
  const logDir = store.getCandidatePaths(options.runId, options.candidate.id).logsDir;
  const stdoutPath = store.getCandidateOracleStdoutLogPath(
    options.runId,
    options.candidate.id,
    oracle.roundId,
    oracle.id,
  );
  const stderrPath = store.getCandidateOracleStderrLogPath(
    options.runId,
    options.candidate.id,
    oracle.roundId,
    oracle.id,
  );

  await mkdir(logDir, { recursive: true });

  try {
    const oracleCwd = resolveOracleCwd(options, oracle);
    const scopeRoot =
      oracle.cwd === "project" ? options.projectRoot : options.candidate.workspaceDir;
    const resolvedEntrypoint = resolveRepoLocalEntrypointCommand({
      command: oracle.command,
      cwd: oracleCwd,
      exists: existsSync,
    });
    const resolvedCommand =
      resolvedEntrypoint.resolution !== "unresolved"
        ? resolvedEntrypoint
        : resolveRepoLocalWrapperCommand({
            command: oracle.command,
            exists: existsSync,
            projectRoot: options.projectRoot,
            scopeRoot,
          });
    const shell = oracle.shell ?? inferRepoOracleShell(resolvedCommand, oracle.args);
    const commandResult = await runSubprocess({
      command: resolvedCommand.resolvedCommand,
      args: oracle.args,
      cwd: oracleCwd,
      env: buildOracleEnvironment(options, oracle, oracleCwd),
      inheritEnv: false,
      ...(shell !== undefined ? { shell } : {}),
      ...(oracle.timeoutMs !== undefined ? { timeoutMs: oracle.timeoutMs } : {}),
    });

    await Promise.all([
      writeTextFileAtomically(stdoutPath, commandResult.stdout),
      writeTextFileAtomically(stderrPath, commandResult.stderr),
    ]);

    const failed = commandResult.exitCode !== 0 || commandResult.timedOut;
    const failureMapping = mapFailureEnforcement(oracle.enforcement);
    const status = failed ? failureMapping.status : "pass";
    const severity = failed ? failureMapping.severity : "info";
    const preferredPath = failed ? stderrPath : stdoutPath;
    const excerpt = summarizeOracleOutput(commandResult.stderr, commandResult.stdout);
    const witness = witnessSchema.parse({
      id: `${options.candidate.id}-${oracle.id}`,
      kind: "command-output",
      title: `Repo-local oracle ${oracle.id}`,
      detail: buildOracleWitnessDetail(
        options,
        oracle,
        oracleCwd,
        resolvedCommand,
        commandResult.exitCode,
        commandResult.timedOut,
      ),
      path: preferredPath,
      ...(excerpt ? { excerpt } : {}),
      scope: [options.candidate.id, oracle.id],
    });

    return {
      verdict: oracleVerdictSchema.parse({
        oracleId: oracle.id,
        roundId: oracle.roundId,
        status,
        severity,
        summary: failed
          ? (oracle.failureSummary ??
            buildFailureSummary(oracle, commandResult.exitCode, commandResult.timedOut))
          : (oracle.passSummary ?? `Repo-local oracle "${oracle.id}" passed.`),
        invariant: oracle.invariant,
        confidence: oracle.confidence,
        ...(failed && oracle.repairHint ? { repairHint: oracle.repairHint } : {}),
        affectedScope: [options.candidate.id],
        witnesses: [witness],
      }),
      witnesses: [witness],
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await Promise.all([
      writeTextFileAtomically(stdoutPath, ""),
      writeTextFileAtomically(stderrPath, `${message}\n`),
    ]);

    const witness = witnessSchema.parse({
      id: `${options.candidate.id}-${oracle.id}`,
      kind: "command-output",
      title: `Repo-local oracle ${oracle.id}`,
      detail: `Repo-local oracle command could not start: ${message}`,
      path: stderrPath,
      excerpt: message.slice(0, 500),
      scope: [options.candidate.id, oracle.id],
    });

    return {
      verdict: oracleVerdictSchema.parse({
        oracleId: oracle.id,
        roundId: oracle.roundId,
        status: "fail",
        severity: "critical",
        summary: oracle.failureSummary ?? `Repo-local oracle "${oracle.id}" could not start.`,
        invariant: oracle.invariant,
        confidence: oracle.confidence,
        ...(oracle.repairHint ? { repairHint: oracle.repairHint } : {}),
        affectedScope: [options.candidate.id],
        witnesses: [witness],
      }),
      witnesses: [witness],
    };
  }
}

function buildOracleEnvironment(
  options: EvaluateCandidateRoundOptions,
  oracle: RepoOracle,
  oracleCwd: string,
): NodeJS.ProcessEnv {
  const store = new RunStore(options.projectRoot);
  const explicitPathEntry = Object.entries(oracle.env ?? {}).find(
    ([key]) => key.toUpperCase() === "PATH",
  );
  const pathKey =
    explicitPathEntry?.[0] ??
    Object.keys(process.env).find((key) => key.toUpperCase() === "PATH") ??
    "PATH";
  const inheritedPath = explicitPathEntry ? explicitPathEntry[1] : process.env[pathKey];
  const localToolPaths = collectOracleLocalToolPaths({
    exists: existsSync,
    projectRoot: options.projectRoot,
    workspaceDir: options.candidate.workspaceDir,
  });
  const oraclePath =
    explicitPathEntry !== undefined
      ? inheritedPath
      : oracle.pathPolicy === "inherit" && inheritedPath
        ? [...localToolPaths, inheritedPath].join(delimiter)
        : localToolPaths.join(delimiter);

  return {
    ...oracle.env,
    ORACULUM_ORACLE_ARGS_JSON: JSON.stringify(oracle.args),
    ORACULUM_PROJECT_ROOT: options.projectRoot,
    ORACULUM_RUN_ID: options.runId,
    ORACULUM_ROUND_ID: options.roundId,
    ORACULUM_AGENT: options.result.adapter,
    ORACULUM_AGENT_STATUS: options.result.status,
    ORACULUM_CANDIDATE_ID: options.candidate.id,
    ORACULUM_CANDIDATE_STRATEGY_ID: options.candidate.strategyId,
    ORACULUM_CANDIDATE_STRATEGY_LABEL: options.candidate.strategyLabel,
    ORACULUM_CANDIDATE_WORKSPACE_DIR: options.candidate.workspaceDir,
    ORACULUM_ORACLE_CWD: oracleCwd,
    ORACULUM_ORACLE_PATH_POLICY: oracle.pathPolicy,
    ORACULUM_CANDIDATE_LOG_DIR: store.getCandidatePaths(options.runId, options.candidate.id)
      .logsDir,
    ORACULUM_CANDIDATE_TASK_PACKET_PATH: options.candidate.taskPacketPath,
    ORACULUM_CANDIDATE_AGENT_RESULT_PATH: store.getCandidatePaths(
      options.runId,
      options.candidate.id,
    ).agentResultPath,
    ...(oraclePath !== undefined ? { [pathKey]: oraclePath } : {}),
  };
}

function resolveOracleCwd(options: EvaluateCandidateRoundOptions, oracle: RepoOracle): string {
  const scopeRoot = oracle.cwd === "project" ? options.projectRoot : options.candidate.workspaceDir;
  if (!oracle.relativeCwd) {
    return scopeRoot;
  }

  const resolved = resolve(scopeRoot, oracle.relativeCwd);
  const relativePath = relative(scopeRoot, resolved);
  if (isContainedRelativePath(relativePath)) {
    const realScopeRoot = realpathSync(scopeRoot);
    const realResolved = existsSync(resolved) ? realpathSync(resolved) : resolved;
    if (isContainedRelativePath(relative(realScopeRoot, realResolved))) {
      return resolved;
    }
  }

  throw new Error(`Oracle "${oracle.id}" relativeCwd escapes the ${oracle.cwd} scope.`);
}

function isContainedRelativePath(relativePath: string): boolean {
  if (relativePath === "") {
    return true;
  }

  const firstSegment = relativePath.split(/[\\/]+/u)[0];
  return firstSegment !== ".." && !isAbsolute(relativePath);
}

function inferRepoOracleShell(
  resolvedCommand: {
    resolvedCommand: string;
    resolution: "local-entrypoint" | "project-wrapper" | "workspace-wrapper" | "unresolved";
  },
  args: string[],
): boolean | undefined {
  if (resolvedCommand.resolution !== "unresolved") {
    return undefined;
  }

  if (args.length === 0) {
    return true;
  }

  if (process.platform !== "win32") {
    return undefined;
  }

  const base = basename(resolvedCommand.resolvedCommand).toLowerCase();
  if (["bun", "npm", "npx", "pnpm", "yarn", "yarnpkg"].includes(base)) {
    return true;
  }

  return undefined;
}

function buildFailureSummary(oracle: RepoOracle, exitCode: number, timedOut: boolean): string {
  if (timedOut) {
    return `Repo-local oracle "${oracle.id}" timed out.`;
  }

  return `Repo-local oracle "${oracle.id}" failed with exit code ${exitCode}.`;
}

function buildOracleWitnessDetail(
  options: EvaluateCandidateRoundOptions,
  oracle: RepoOracle,
  oracleCwd: string,
  resolvedCommand: {
    resolvedCommand: string;
    resolution: "local-entrypoint" | "project-wrapper" | "workspace-wrapper" | "unresolved";
  },
  exitCode: number,
  timedOut: boolean,
): string {
  return [
    `Command exited with code ${exitCode}.`,
    timedOut ? "The command timed out." : undefined,
    `Scope=${oracle.cwd === "project" ? "project" : "workspace"}.`,
    oracle.relativeCwd ? `RelativeCwd=${oracle.relativeCwd}.` : undefined,
    resolvedCommand.resolution !== "unresolved"
      ? `ResolvedCommand=${resolvedCommand.resolvedCommand} (${resolvedCommand.resolution}).`
      : undefined,
    `PathPolicy=${oracle.pathPolicy}.`,
    oracle.safetyRationale ? `Safety=${oracle.safetyRationale}` : undefined,
    `OracleCwd=${oracleCwd}.`,
    `Workspace=${options.candidate.workspaceDir}.`,
  ]
    .filter((part) => part !== undefined)
    .join(" ");
}

function mapFailureEnforcement(enforcement: OracleEnforcement): {
  severity: OracleVerdict["severity"];
  status: OracleVerdict["status"];
} {
  switch (enforcement) {
    case "hard":
      return { status: "fail", severity: "error" };
    case "repairable":
      return { status: "repairable", severity: "warning" };
    case "signal":
      return { status: "pass", severity: "warning" };
  }
}

function summarizeOracleOutput(stderr: string, stdout: string): string | undefined {
  const preferred = stderr.trim() || stdout.trim();
  return preferred ? preferred.slice(0, 500) : undefined;
}
