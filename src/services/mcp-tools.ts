import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";

import { OraculumError } from "../core/errors.js";
import { getExportSyncSummaryPath, resolveProjectRoot } from "../core/paths.js";
import { runSubprocess } from "../core/subprocess.js";
import {
  type ConsultToolRequest,
  type ConsultToolResponse,
  type CrownMaterialization,
  type CrownMaterializationCheck,
  type CrownToolRequest,
  type CrownToolResponse,
  consultToolRequestSchema,
  consultToolResponseSchema,
  crownToolRequestSchema,
  crownToolResponseSchema,
  type DraftToolRequest,
  type DraftToolResponse,
  draftToolRequestSchema,
  draftToolResponseSchema,
  type InitToolRequest,
  type InitToolResponse,
  initToolRequestSchema,
  initToolResponseSchema,
  type SetupStatusToolRequest,
  type SetupStatusToolResponse,
  setupStatusToolRequestSchema,
  setupStatusToolResponseSchema,
  type VerdictArchiveToolRequest,
  type VerdictArchiveToolResponse,
  type VerdictToolRequest,
  type VerdictToolResponse,
  verdictArchiveToolRequestSchema,
  verdictArchiveToolResponseSchema,
  verdictToolRequestSchema,
  verdictToolResponseSchema,
} from "../domain/chat-native.js";
import { type Adapter, adapterSchema } from "../domain/config.js";
import { buildSavedConsultationStatus, isPreflightBlockedConsultation } from "../domain/run.js";
import {
  buildConsultationArtifacts,
  buildProjectInitializationResult,
  buildSetupDiagnosticsResponse,
  filterSetupDiagnosticsResponse,
} from "./chat-native.js";
import {
  buildVerdictReview,
  listRecentConsultations,
  renderConsultationArchive,
  renderConsultationSummary,
} from "./consultations.js";
import { executeRun } from "./execution.js";
import { materializeExport } from "./exports.js";
import { ensureProjectInitialized, initializeProject } from "./project.js";
import { planRun, readLatestRunManifest, readRunManifest, writeLatestRunState } from "./runs.js";

export async function runConsultTool(input: ConsultToolRequest): Promise<ConsultToolResponse> {
  const request = normalizeConsultToolRequest(consultToolRequestSchema.parse(input));
  const hostDefaultAgent = resolveHostAgentRuntime();
  const initialized = await ensureProjectInitialized(request.cwd, {
    ...(hostDefaultAgent ? { defaultAgent: hostDefaultAgent } : {}),
  });
  const manifest = await planRun({
    cwd: request.cwd,
    taskInput: request.taskInput,
    ...(request.agent ? { agent: request.agent } : {}),
    ...(request.candidates !== undefined ? { candidates: request.candidates } : {}),
    preflight: {
      allowRuntime: true,
      ...(request.timeoutMs !== undefined ? { timeoutMs: request.timeoutMs } : {}),
    },
    autoProfile: {
      allowRuntime: true,
      ...(request.timeoutMs !== undefined ? { timeoutMs: request.timeoutMs } : {}),
    },
  });
  if (isPreflightBlockedConsultation(manifest)) {
    await writeLatestRunState(resolveProjectRoot(request.cwd), manifest.id);
    return consultToolResponseSchema.parse({
      mode: "consult",
      consultation: manifest,
      status: buildSavedConsultationStatus(manifest),
      summary: await renderConsultationSummary(manifest, request.cwd, {
        surface: "chat-native",
      }),
      artifacts: buildConsultationArtifacts(request.cwd, manifest.id),
      ...(initialized ? { initializedProject: buildProjectInitializationResult(initialized) } : {}),
    });
  }
  const execution = await executeRun({
    cwd: request.cwd,
    runId: manifest.id,
    ...(request.timeoutMs !== undefined ? { timeoutMs: request.timeoutMs } : {}),
  });

  return consultToolResponseSchema.parse({
    mode: "consult",
    consultation: execution.manifest,
    status: buildSavedConsultationStatus(execution.manifest),
    summary: await renderConsultationSummary(execution.manifest, request.cwd, {
      surface: "chat-native",
    }),
    artifacts: buildConsultationArtifacts(request.cwd, execution.manifest.id),
    ...(initialized ? { initializedProject: buildProjectInitializationResult(initialized) } : {}),
  });
}

export async function runDraftTool(input: DraftToolRequest): Promise<DraftToolResponse> {
  const request = normalizeDraftToolRequest(draftToolRequestSchema.parse(input));
  const hostDefaultAgent = resolveHostAgentRuntime();
  const initialized = await ensureProjectInitialized(request.cwd, {
    ...(hostDefaultAgent ? { defaultAgent: hostDefaultAgent } : {}),
  });
  const manifest = await planRun({
    cwd: request.cwd,
    taskInput: request.taskInput,
    ...(request.agent ? { agent: request.agent } : {}),
    ...(request.candidates !== undefined ? { candidates: request.candidates } : {}),
    autoProfile: {
      allowRuntime: false,
    },
  });

  return draftToolResponseSchema.parse({
    mode: "draft",
    consultation: manifest,
    status: buildSavedConsultationStatus(manifest),
    summary: await renderConsultationSummary(manifest, request.cwd, {
      surface: "chat-native",
    }),
    artifacts: buildConsultationArtifacts(request.cwd, manifest.id),
    ...(initialized ? { initializedProject: buildProjectInitializationResult(initialized) } : {}),
  });
}

export async function runVerdictTool(input: VerdictToolRequest): Promise<VerdictToolResponse> {
  const request = verdictToolRequestSchema.parse(input);
  const manifest = request.consultationId
    ? await readRunManifest(request.cwd, request.consultationId)
    : await readLatestRunManifest(request.cwd);
  const artifacts = buildConsultationArtifacts(request.cwd, manifest.id);

  return verdictToolResponseSchema.parse({
    mode: "verdict",
    consultation: manifest,
    status: buildSavedConsultationStatus(manifest),
    review: buildVerdictReview(manifest, artifacts),
    summary: await renderConsultationSummary(manifest, request.cwd, {
      surface: "chat-native",
    }),
    artifacts,
  });
}

export async function runVerdictArchiveTool(
  input: VerdictArchiveToolRequest,
): Promise<VerdictArchiveToolResponse> {
  const request = verdictArchiveToolRequestSchema.parse(input);
  const consultations = await listRecentConsultations(request.cwd, request.count);

  return verdictArchiveToolResponseSchema.parse({
    mode: "verdict-archive",
    consultations,
    archive: renderConsultationArchive(consultations, {
      surface: "chat-native",
    }),
  });
}

export async function runCrownTool(input: CrownToolRequest): Promise<CrownToolResponse> {
  const request = normalizeCrownToolRequest(input);
  const result = await materializeExport({
    cwd: request.cwd,
    ...(request.branchName ? { branchName: request.branchName } : {}),
    ...(request.materializationLabel ? { materializationLabel: request.materializationLabel } : {}),
    withReport: request.withReport,
    ...(request.consultationId ? { runId: request.consultationId } : {}),
    ...(request.candidateId ? { winnerId: request.candidateId } : {}),
  });
  const consultation = await readRunManifest(request.cwd, result.plan.runId);
  const materialization = await buildCrownMaterialization(request.cwd, result.plan);

  return crownToolResponseSchema.parse({
    mode: "crown",
    plan: result.plan,
    recordPath: result.path,
    materialization,
    consultation,
    status: buildSavedConsultationStatus(consultation),
  });
}

function normalizeCrownToolRequest(request: CrownToolRequest): CrownToolRequest {
  return crownToolRequestSchema.parse({
    ...request,
    ...(request.branchName !== undefined
      ? { branchName: normalizeOptionalStringInput(request.branchName) }
      : {}),
    ...(request.materializationLabel !== undefined
      ? { materializationLabel: normalizeOptionalStringInput(request.materializationLabel) }
      : {}),
  });
}

export async function runInitTool(input: InitToolRequest): Promise<InitToolResponse> {
  const request = initToolRequestSchema.parse(input);
  const hostDefaultAgent = resolveHostAgentRuntime();
  const initialization = await initializeProject({
    cwd: request.cwd,
    ...(hostDefaultAgent ? { defaultAgent: hostDefaultAgent } : {}),
    force: request.force,
  });

  return initToolResponseSchema.parse({
    mode: "init",
    initialization: buildProjectInitializationResult(initialization),
  });
}

export async function runSetupStatusTool(
  input: SetupStatusToolRequest,
): Promise<SetupStatusToolResponse> {
  const request = setupStatusToolRequestSchema.parse(input);

  return filterSetupDiagnosticsResponse(
    setupStatusToolResponseSchema.parse(await buildSetupDiagnosticsResponse(request.cwd)),
    request.host,
  );
}

function normalizeConsultToolRequest(request: ConsultToolRequest): ConsultToolRequest {
  const parsed = parseInlineCommandOptions(request.taskInput, {
    allowTimeoutMs: true,
  });
  return consultToolRequestSchema.parse({
    ...request,
    taskInput: parsed.taskInput,
    ...(parsed.agent ? { agent: parsed.agent } : {}),
    ...(parsed.candidates !== undefined ? { candidates: parsed.candidates } : {}),
    ...(parsed.timeoutMs !== undefined ? { timeoutMs: parsed.timeoutMs } : {}),
  });
}

function normalizeDraftToolRequest(request: DraftToolRequest): DraftToolRequest {
  const parsed = parseInlineCommandOptions(request.taskInput, {
    allowTimeoutMs: false,
  });
  return draftToolRequestSchema.parse({
    ...request,
    taskInput: parsed.taskInput,
    ...(parsed.agent ? { agent: parsed.agent } : {}),
    ...(parsed.candidates !== undefined ? { candidates: parsed.candidates } : {}),
  });
}

function normalizeOptionalStringInput(value: string | undefined): string | undefined {
  if (value === undefined) {
    return undefined;
  }

  return value.trim().length > 0 ? value : undefined;
}

function parseInlineCommandOptions(
  taskInput: string,
  options: { allowTimeoutMs: boolean },
): {
  agent?: Adapter;
  candidates?: number;
  taskInput: string;
  timeoutMs?: number;
} {
  const tokens = splitShellLike(taskInput);
  if (!tokens) {
    return { taskInput };
  }

  const remaining: string[] = [];
  let agent: Adapter | undefined;
  let candidates: number | undefined;
  let timeoutMs: number | undefined;
  let parsedAnyOption = false;

  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index];
    if (!token) {
      continue;
    }

    const readOptionValue = (
      optionName: string,
    ): { matched: true; value: string } | { matched: false } => {
      const inlinePrefix = `${optionName}=`;
      if (token.startsWith(inlinePrefix)) {
        return { matched: true, value: token.slice(inlinePrefix.length) };
      }
      if (token === optionName) {
        const value = tokens[index + 1];
        if (value === undefined) {
          throw new OraculumError(`${optionName} requires a value.`);
        }
        index += 1;
        return { matched: true, value };
      }
      return { matched: false };
    };

    const agentValue = readOptionValue("--agent");
    if (agentValue.matched) {
      parsedAnyOption = true;
      const parsedAgent = adapterSchema.parse(agentValue.value);
      agent = parsedAgent;
      continue;
    }

    const candidatesValue = readOptionValue("--candidates");
    if (candidatesValue.matched) {
      parsedAnyOption = true;
      candidates = parseIntegerOption(candidatesValue.value, "--candidates");
      continue;
    }

    const timeoutValue = options.allowTimeoutMs ? readOptionValue("--timeout-ms") : undefined;
    if (timeoutValue?.matched) {
      parsedAnyOption = true;
      timeoutMs = parseIntegerOption(timeoutValue.value, "--timeout-ms");
      continue;
    }

    remaining.push(token);
  }

  if (!parsedAnyOption) {
    return { taskInput };
  }

  return {
    ...(agent ? { agent } : {}),
    ...(candidates !== undefined ? { candidates } : {}),
    taskInput: remaining.join(" "),
    ...(timeoutMs !== undefined ? { timeoutMs } : {}),
  };
}

function splitShellLike(value: string): string[] | undefined {
  const tokens: string[] = [];
  let current = "";
  let quote: "'" | '"' | undefined;

  for (let index = 0; index < value.length; index += 1) {
    const character = value[index];
    if (!character) {
      continue;
    }
    const next = value[index + 1];

    if (character === "\\") {
      if (quote) {
        if (next === quote || next === "\\") {
          current += next;
          index += 1;
          continue;
        }

        current += character;
        continue;
      }

      if (next === '"' || next === "'" || next === "\\" || (next && /\s/u.test(next))) {
        current += next;
        index += 1;
        continue;
      }

      current += character;
      continue;
    }

    if (quote) {
      if (character === quote) {
        quote = undefined;
      } else {
        current += character;
      }
      continue;
    }

    if (character === "'" || character === '"') {
      quote = character;
      continue;
    }

    if (/\s/u.test(character)) {
      if (current.length > 0) {
        tokens.push(current);
        current = "";
      }
      continue;
    }

    current += character;
  }

  if (quote) {
    return undefined;
  }
  if (current.length > 0) {
    tokens.push(current);
  }

  return tokens;
}

function parseIntegerOption(value: string | undefined, optionName: string): number {
  if (value === undefined || value.trim().length === 0) {
    throw new OraculumError(`${optionName} requires a value.`);
  }

  const parsed = Number(value);
  if (!Number.isInteger(parsed)) {
    throw new OraculumError(`${optionName} must be an integer.`);
  }

  return parsed;
}

function resolveHostAgentRuntime(): Adapter | undefined {
  const parsed = adapterSchema.safeParse(process.env.ORACULUM_AGENT_RUNTIME);
  return parsed.success ? parsed.data : undefined;
}

async function buildCrownMaterialization(
  cwd: string,
  plan: CrownToolResponse["plan"],
): Promise<CrownMaterialization> {
  const projectRoot = resolveProjectRoot(cwd);
  const checks: CrownMaterializationCheck[] = [];
  let currentBranch: string | undefined;

  if (plan.mode === "git-branch") {
    const branchName = requireMaterializedBranchName(plan);
    checks.push(assertGitPatchArtifact(plan));
    currentBranch = await readVerifiedCurrentGitBranch(projectRoot, branchName);
    checks.push({
      id: "current-branch",
      status: "passed",
      summary: `Current git branch is ${currentBranch}.`,
    });
  }

  if (plan.mode === "workspace-sync") {
    checks.push(assertWorkspaceSyncSummary(projectRoot, plan.runId));
  }

  const changedPaths = await readMaterializedChangedPaths(projectRoot, plan);
  if (changedPaths.length === 0) {
    throw new OraculumError(
      `Crowning post-check failed: no materialized changed paths were detected for ${plan.mode} export "${plan.runId}".`,
    );
  }
  checks.push({
    id: "changed-paths",
    status: "passed",
    summary: `${changedPaths.length} changed path${changedPaths.length === 1 ? "" : "s"} detected.`,
  });

  const materializationLabel =
    plan.mode === "workspace-sync" ? (plan.materializationLabel ?? plan.branchName) : undefined;

  return {
    materialized: true,
    verified: true,
    mode: plan.mode,
    ...(plan.mode === "git-branch" && plan.branchName ? { branchName: plan.branchName } : {}),
    ...(materializationLabel ? { materializationLabel } : {}),
    ...(currentBranch ? { currentBranch } : {}),
    changedPaths,
    changedPathCount: changedPaths.length,
    checks,
  };
}

function requireMaterializedBranchName(plan: CrownToolResponse["plan"]): string {
  if (!plan.branchName) {
    throw new OraculumError(
      `Crowning post-check failed: git-branch export "${plan.runId}" did not record a branch name.`,
    );
  }

  return plan.branchName;
}

function assertGitPatchArtifact(plan: CrownToolResponse["plan"]): CrownMaterializationCheck {
  if (!plan.patchPath) {
    throw new OraculumError(
      `Crowning post-check failed: git-branch export "${plan.runId}" did not record an export patch path.`,
    );
  }

  if (!existsSync(plan.patchPath)) {
    throw new OraculumError(
      `Crowning post-check failed: expected export patch does not exist at ${plan.patchPath}.`,
    );
  }

  return {
    id: "git-patch-artifact",
    status: "passed",
    summary: `Export patch exists at ${plan.patchPath}.`,
  };
}

function assertWorkspaceSyncSummary(projectRoot: string, runId: string): CrownMaterializationCheck {
  const syncSummaryPath = getExportSyncSummaryPath(projectRoot, runId);
  if (!existsSync(syncSummaryPath)) {
    throw new OraculumError(
      `Crowning post-check failed: expected workspace-sync summary does not exist at ${syncSummaryPath}.`,
    );
  }

  return {
    id: "workspace-sync-summary",
    status: "passed",
    summary: `Workspace-sync summary exists at ${syncSummaryPath}.`,
  };
}

async function readVerifiedCurrentGitBranch(
  projectRoot: string,
  expectedBranch: string,
): Promise<string> {
  const currentBranch = await readCurrentGitBranch(projectRoot);
  if (!currentBranch) {
    throw new OraculumError(
      `Crowning post-check failed: could not determine the current git branch in ${projectRoot}.`,
    );
  }

  if (currentBranch !== expectedBranch) {
    throw new OraculumError(
      `Crowning post-check failed: expected current git branch "${expectedBranch}", received "${currentBranch}".`,
    );
  }

  return currentBranch;
}

async function readCurrentGitBranch(projectRoot: string): Promise<string | undefined> {
  const result = await runSubprocess({
    command: "git",
    args: ["branch", "--show-current"],
    cwd: projectRoot,
    timeoutMs: 10_000,
  }).catch(() => undefined);
  if (!result) {
    return undefined;
  }

  const branch = result.stdout.trim();
  return result.exitCode === 0 && branch.length > 0 ? branch : undefined;
}

async function readMaterializedChangedPaths(
  projectRoot: string,
  plan: CrownToolResponse["plan"],
): Promise<string[]> {
  if (plan.mode === "git-branch") {
    if (!plan.patchPath) {
      throw new OraculumError(
        `Crowning post-check failed: git-branch export "${plan.runId}" did not record an export patch path.`,
      );
    }

    try {
      return parseGitPatchChangedPaths(await readFile(plan.patchPath, "utf8"));
    } catch (error) {
      throw new OraculumError(
        `Crowning post-check failed: could not read export patch at ${plan.patchPath}: ${formatUnknownError(error)}`,
      );
    }
  }

  const syncSummaryPath = getExportSyncSummaryPath(projectRoot, plan.runId);
  if (!existsSync(syncSummaryPath)) {
    throw new OraculumError(
      `Crowning post-check failed: expected workspace-sync summary does not exist at ${syncSummaryPath}.`,
    );
  }

  try {
    const parsed = JSON.parse(await readFile(syncSummaryPath, "utf8")) as {
      appliedFiles?: unknown;
      removedFiles?: unknown;
    };
    return uniqueSortedStrings([
      ...(Array.isArray(parsed.appliedFiles) ? parsed.appliedFiles : []),
      ...(Array.isArray(parsed.removedFiles) ? parsed.removedFiles : []),
    ]);
  } catch (error) {
    throw new OraculumError(
      `Crowning post-check failed: could not read workspace-sync summary at ${syncSummaryPath}: ${formatUnknownError(error)}`,
    );
  }
}

function parseGitPatchChangedPaths(patch: string): string[] {
  const paths: string[] = [];
  let oldPath: string | undefined;

  for (const line of patch.split(/\r?\n/u)) {
    if (line.startsWith("--- ")) {
      oldPath = normalizePatchPath(line.slice(4));
      continue;
    }

    if (!line.startsWith("+++ ")) {
      continue;
    }

    const newPath = normalizePatchPath(line.slice(4));
    paths.push(...[oldPath, newPath].filter((value): value is string => Boolean(value)));
    oldPath = undefined;
  }

  return uniqueSortedStrings(paths);
}

function normalizePatchPath(value: string): string | undefined {
  const [path] = value.trim().split(/\t/u);
  if (!path) {
    return undefined;
  }

  if (path === "/dev/null") {
    return undefined;
  }

  if (path.startsWith("a/") || path.startsWith("b/")) {
    return path.slice(2);
  }

  return path.length > 0 ? path : undefined;
}

function uniqueSortedStrings(values: unknown[]): string[] {
  return [...new Set(values.filter((value): value is string => typeof value === "string"))]
    .map((value) => value.trim())
    .filter((value) => value.length > 0)
    .sort((left, right) => left.localeCompare(right));
}

function formatUnknownError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
