import { existsSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { basename, delimiter, join } from "node:path";

import type { AgentRunResult } from "../adapters/types.js";
import {
  getCandidateAgentResultPath,
  getCandidateLogsDir,
  getCandidateOracleStderrLogPath,
  getCandidateOracleStdoutLogPath,
} from "../core/paths.js";
import { runSubprocess } from "../core/subprocess.js";
import type { OracleEnforcement, ProjectConfig, RepoOracle, RoundId } from "../domain/config.js";
import {
  type OracleVerdict,
  oracleVerdictSchema,
  type Witness,
  witnessSchema,
} from "../domain/oracle.js";
import type { CandidateManifest } from "../domain/run.js";
import { collectCandidateChangeInsight } from "./change-insights.js";

interface EvaluateCandidateRoundOptions {
  candidate: CandidateManifest;
  projectConfig: ProjectConfig;
  projectRoot: string;
  result: AgentRunResult;
  roundId: RoundId;
  runId: string;
}

interface EvaluateCandidateRoundResult {
  survives: boolean;
  verdicts: OracleVerdict[];
  witnesses: Witness[];
}

interface OracleEvaluation {
  verdict: OracleVerdict;
  witnesses: Witness[];
}

interface OracleDefinition {
  evaluate(options: EvaluateCandidateRoundOptions): Promise<OracleEvaluation> | OracleEvaluation;
  oracleId: string;
  roundId: RoundId;
}

const builtInOracles: OracleDefinition[] = [
  {
    oracleId: "agent-exit",
    roundId: "fast",
    evaluate(options) {
      const exitWitness = witnessSchema.parse({
        id: `${options.candidate.id}-agent-exit`,
        kind: "log",
        title: "Agent process exit",
        detail: `Adapter status=${options.result.status}, exitCode=${options.result.exitCode}.`,
        scope: [options.candidate.id, options.candidate.strategyId],
      });

      return {
        verdict: oracleVerdictSchema.parse({
          oracleId: "agent-exit",
          roundId: "fast",
          status: options.result.status === "completed" ? "pass" : "fail",
          severity: options.result.status === "completed" ? "info" : "error",
          summary:
            options.result.status === "completed"
              ? "Agent completed without a process failure."
              : "Agent execution did not complete successfully.",
          invariant: "The host adapter must finish candidate execution successfully.",
          confidence: "high",
          affectedScope: [options.candidate.id],
          witnesses: [exitWitness],
        }),
        witnesses: [exitWitness],
      };
    },
  },
  {
    oracleId: "artifact-capture",
    roundId: "fast",
    evaluate(options) {
      const hasMaterializedOutput = options.result.artifacts.some(
        (artifact) => artifact.kind !== "prompt" && artifact.kind !== "stderr",
      );
      const artifactWitness = witnessSchema.parse({
        id: `${options.candidate.id}-artifact-capture`,
        kind: "file",
        title: "Captured execution artifacts",
        detail: `Persisted ${options.result.artifacts.length} agent artifact(s).`,
        scope: [options.candidate.id],
        excerpt: options.result.artifacts.map((artifact) => artifact.kind).join(", "),
      });

      return {
        verdict: oracleVerdictSchema.parse({
          oracleId: "artifact-capture",
          roundId: "fast",
          status: hasMaterializedOutput ? "pass" : "fail",
          severity: hasMaterializedOutput ? "info" : "warning",
          summary: hasMaterializedOutput
            ? "Execution produced persisted artifacts for later review."
            : "Execution did not leave enough artifacts for review.",
          invariant: "Each candidate run must persist inspectable execution artifacts.",
          confidence: "high",
          affectedScope: [options.candidate.id],
          repairHint: hasMaterializedOutput
            ? undefined
            : "Capture stdout, transcripts, reports, or patches from the host runtime.",
          witnesses: [artifactWitness],
        }),
        witnesses: [artifactWitness],
      };
    },
  },
  {
    oracleId: "reviewable-output",
    roundId: "impact",
    evaluate(options) {
      const reviewableKinds = new Set(["stdout", "transcript", "report", "patch"]);
      const hasReviewableOutput = options.result.artifacts.some((artifact) =>
        reviewableKinds.has(artifact.kind),
      );
      const outputWitness = witnessSchema.parse({
        id: `${options.candidate.id}-reviewable-output`,
        kind: "file",
        title: "Reviewable output coverage",
        detail: hasReviewableOutput
          ? "Execution left reviewable output for comparison."
          : "Execution did not leave reviewable output for comparison.",
        scope: [options.candidate.id],
        excerpt: options.result.artifacts.map((artifact) => artifact.kind).join(", "),
      });

      return {
        verdict: oracleVerdictSchema.parse({
          oracleId: "reviewable-output",
          roundId: "impact",
          status: hasReviewableOutput ? "pass" : "repairable",
          severity: hasReviewableOutput ? "info" : "warning",
          summary: hasReviewableOutput
            ? "Candidate left artifacts suitable for human or automated comparison."
            : "Candidate lacks reviewable output artifacts beyond prompt/stderr.",
          invariant: "Candidates should leave reviewable output for later comparison.",
          confidence: "medium",
          affectedScope: [options.candidate.id],
          repairHint: hasReviewableOutput
            ? undefined
            : "Persist stdout, transcript, report, or patch artifacts from the runtime.",
          witnesses: [outputWitness],
        }),
        witnesses: [outputWitness],
      };
    },
  },
  {
    oracleId: "materialized-patch",
    roundId: "impact",
    async evaluate(options) {
      const changeInsight = await collectCandidateChangeInsight(options.candidate);
      const hasMaterializedPatch = changeInsight.changeSummary.changedPathCount > 0;
      const changeWitness = witnessSchema.parse({
        id: `${options.candidate.id}-materialized-patch`,
        kind: "file",
        title: "Materialized workspace changes",
        detail: hasMaterializedPatch
          ? `Captured ${changeInsight.changeSummary.changedPathCount} changed path(s) in the candidate workspace.`
          : "The candidate left no materialized file changes in the workspace.",
        scope: [options.candidate.id],
        ...(changeInsight.changedPaths.length > 0
          ? { excerpt: changeInsight.changedPaths.slice(0, 8).join(", ") }
          : {}),
      });

      return {
        verdict: oracleVerdictSchema.parse({
          oracleId: "materialized-patch",
          roundId: "impact",
          status: hasMaterializedPatch ? "pass" : "repairable",
          severity: hasMaterializedPatch ? "info" : "warning",
          summary: hasMaterializedPatch
            ? "Candidate left materialized file changes in the workspace."
            : "Candidate described a patch but did not leave materialized file changes.",
          invariant: "Each surviving candidate must leave a materialized patch in its workspace.",
          confidence: "high",
          affectedScope: [options.candidate.id],
          repairHint: hasMaterializedPatch
            ? undefined
            : "Edit the necessary files in the workspace and leave the real patch on disk. Do not only describe the change.",
          witnesses: [changeWitness],
        }),
        witnesses: [changeWitness],
      };
    },
  },
];

export async function evaluateCandidateRound(
  options: EvaluateCandidateRoundOptions,
): Promise<EvaluateCandidateRoundResult> {
  if (options.roundId !== "fast" && options.result.status !== "completed") {
    return {
      survives: false,
      verdicts: [],
      witnesses: [],
    };
  }

  const verdicts: OracleVerdict[] = [];
  const witnesses: Witness[] = [];

  const selectedBuiltIns = builtInOracles.filter((oracle) => oracle.roundId === options.roundId);
  for (const oracle of selectedBuiltIns) {
    const evaluation = await oracle.evaluate(options);
    verdicts.push(evaluation.verdict);
    witnesses.push(...evaluation.witnesses);
  }

  const selectedRepoOracles = options.projectConfig.oracles.filter(
    (oracle) => oracle.roundId === options.roundId,
  );
  if (options.result.status === "completed") {
    for (const oracle of selectedRepoOracles) {
      const evaluation = await evaluateRepoOracle(options, oracle);
      verdicts.push(evaluation.verdict);
      witnesses.push(...evaluation.witnesses);
    }
  }

  return {
    survives: verdicts.every((verdict) => verdict.status === "pass" || verdict.status === "skip"),
    verdicts,
    witnesses,
  };
}

async function evaluateRepoOracle(
  options: EvaluateCandidateRoundOptions,
  oracle: RepoOracle,
): Promise<OracleEvaluation> {
  const logDir = getCandidateLogsDir(options.projectRoot, options.runId, options.candidate.id);
  const stdoutPath = getCandidateOracleStdoutLogPath(
    options.projectRoot,
    options.runId,
    options.candidate.id,
    oracle.roundId,
    oracle.id,
  );
  const stderrPath = getCandidateOracleStderrLogPath(
    options.projectRoot,
    options.runId,
    options.candidate.id,
    oracle.roundId,
    oracle.id,
  );

  await mkdir(logDir, { recursive: true });

  try {
    const shell = oracle.shell ?? inferRepoOracleShell(oracle.command, oracle.args);
    const commandResult = await runSubprocess({
      command: oracle.command,
      args: oracle.args,
      cwd: oracle.cwd === "project" ? options.projectRoot : options.candidate.workspaceDir,
      env: buildOracleEnvironment(options, oracle),
      ...(shell !== undefined ? { shell } : {}),
      ...(oracle.timeoutMs !== undefined ? { timeoutMs: oracle.timeoutMs } : {}),
    });

    await Promise.all([
      writeFile(stdoutPath, commandResult.stdout, "utf8"),
      writeFile(stderrPath, commandResult.stderr, "utf8"),
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
      writeFile(stdoutPath, "", "utf8"),
      writeFile(stderrPath, `${message}\n`, "utf8"),
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
): NodeJS.ProcessEnv {
  const explicitPathEntry = Object.entries(oracle.env ?? {}).find(
    ([key]) => key.toUpperCase() === "PATH",
  );
  const pathKey =
    explicitPathEntry?.[0] ??
    Object.keys(process.env).find((key) => key.toUpperCase() === "PATH") ??
    "PATH";
  const inheritedPath = explicitPathEntry ? explicitPathEntry[1] : process.env[pathKey];
  const localToolPaths = collectLocalToolPaths(options);
  const oraclePath =
    explicitPathEntry !== undefined
      ? inheritedPath
      : localToolPaths.length > 0
        ? [...localToolPaths, ...(inheritedPath ? [inheritedPath] : [])].join(delimiter)
        : inheritedPath;

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
    ORACULUM_CANDIDATE_LOG_DIR: getCandidateLogsDir(
      options.projectRoot,
      options.runId,
      options.candidate.id,
    ),
    ORACULUM_CANDIDATE_TASK_PACKET_PATH: options.candidate.taskPacketPath,
    ORACULUM_CANDIDATE_AGENT_RESULT_PATH: getCandidateAgentResultPath(
      options.projectRoot,
      options.runId,
      options.candidate.id,
    ),
    ...(oraclePath !== undefined ? { [pathKey]: oraclePath } : {}),
  };
}

function collectLocalToolPaths(options: EvaluateCandidateRoundOptions): string[] {
  const candidateWorkspaceDir = options.candidate.workspaceDir;
  const roots = [candidateWorkspaceDir, options.projectRoot];
  const relativeToolDirs = [
    join("node_modules", ".bin"),
    join(".venv", process.platform === "win32" ? "Scripts" : "bin"),
    join("venv", process.platform === "win32" ? "Scripts" : "bin"),
    "bin",
  ];
  const seen = new Set<string>();
  const paths: string[] = [];

  for (const root of roots) {
    for (const relativeDir of relativeToolDirs) {
      const absolutePath = join(root, relativeDir);
      if (!seen.has(absolutePath) && existsSync(absolutePath)) {
        seen.add(absolutePath);
        paths.push(absolutePath);
      }
    }
  }

  return paths;
}

function inferRepoOracleShell(command: string, args: string[]): boolean | undefined {
  if (args.length === 0) {
    return true;
  }

  if (process.platform !== "win32") {
    return undefined;
  }

  const base = basename(command).toLowerCase();
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
  exitCode: number,
  timedOut: boolean,
): string {
  return [
    `Command exited with code ${exitCode}.`,
    timedOut ? "The command timed out." : undefined,
    `Scope=${oracle.cwd === "project" ? "project" : "workspace"}.`,
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
