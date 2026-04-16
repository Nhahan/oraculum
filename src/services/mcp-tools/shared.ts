import { OraculumError } from "../../core/errors.js";
import { type Adapter, adapterSchema } from "../../domain/config.js";
import { buildSavedConsultationStatus } from "../../domain/run.js";

import { buildProjectInitializationResult } from "../chat-native.js";
import {
  type ConsultationArtifactState,
  resolveConsultationArtifacts,
  toAvailableConsultationArtifactPaths,
} from "../consultation-artifacts.js";
import { renderConsultationSummary } from "../consultations.js";
import { ensureProjectInitialized } from "../project.js";
import type { planRun, readRunManifest } from "../runs.js";

export interface InlinePlanningToolRequest {
  cwd: string;
  taskInput: string;
  agent?: Adapter | undefined;
  candidates?: number | undefined;
  timeoutMs?: number | undefined;
}

export async function ensureProjectInitializedForTool(cwd: string) {
  const hostDefaultAgent = resolveHostAgentRuntime();
  return ensureProjectInitialized(cwd, {
    ...(hostDefaultAgent ? { defaultAgent: hostDefaultAgent } : {}),
  });
}

export function buildPlanRunRequest(
  request: InlinePlanningToolRequest,
  options?: {
    writeConsultationPlanArtifacts?: boolean;
  },
): Parameters<typeof planRun>[0] {
  return {
    cwd: request.cwd,
    taskInput: request.taskInput,
    ...(request.agent ? { agent: request.agent } : {}),
    ...(request.candidates !== undefined ? { candidates: request.candidates } : {}),
    ...(options?.writeConsultationPlanArtifacts ? { writeConsultationPlanArtifacts: true } : {}),
    preflight: {
      allowRuntime: true,
      ...(request.timeoutMs !== undefined ? { timeoutMs: request.timeoutMs } : {}),
    },
    autoProfile: {
      allowRuntime: true,
      ...(request.timeoutMs !== undefined ? { timeoutMs: request.timeoutMs } : {}),
    },
  };
}

export async function buildConsultationToolPayload(
  cwd: string,
  consultation: Awaited<ReturnType<typeof readRunManifest>>,
  initialized?: Awaited<ReturnType<typeof ensureProjectInitialized>>,
) {
  const artifacts = await resolveToolConsultationArtifacts(cwd, consultation);

  return {
    consultation,
    status: await buildArtifactAwareConsultationStatus(consultation, artifacts),
    summary: await renderConsultationSummary(consultation, cwd, {
      surface: "chat-native",
    }),
    artifacts: toAvailableConsultationArtifactPaths(artifacts),
    ...(initialized ? { initializedProject: buildProjectInitializationResult(initialized) } : {}),
  };
}

export async function buildArtifactAwareConsultationStatus(
  consultation: Awaited<ReturnType<typeof readRunManifest>>,
  artifacts: ConsultationArtifactState,
) {
  return buildSavedConsultationStatus(consultation, {
    comparisonReportAvailable: artifacts.comparisonReportAvailable,
    crowningRecordAvailable: artifacts.crowningRecordAvailable,
    ...(artifacts.manualReviewRequired ? { manualReviewRequired: true } : {}),
  });
}

export async function resolveToolConsultationArtifacts(
  cwd: string,
  consultation: Awaited<ReturnType<typeof readRunManifest>>,
) {
  return resolveConsultationArtifacts(cwd, consultation.id, {
    hasExportedCandidate: consultation.candidates.some(
      (candidate) => candidate.status === "exported",
    ),
  });
}

export function normalizePlanningToolRequest<TRequest extends InlinePlanningToolRequest>(
  request: TRequest,
): TRequest {
  const parsed = parseInlineCommandOptions(request.taskInput, {
    allowTimeoutMs: true,
  });
  return {
    ...request,
    taskInput: parsed.taskInput,
    ...(parsed.agent ? { agent: parsed.agent } : {}),
    ...(parsed.candidates !== undefined ? { candidates: parsed.candidates } : {}),
    ...(parsed.timeoutMs !== undefined ? { timeoutMs: parsed.timeoutMs } : {}),
  };
}

export function normalizeOptionalStringInput(value: string | undefined): string | undefined {
  if (value === undefined) {
    return undefined;
  }

  return value.trim().length > 0 ? value : undefined;
}

export function resolveHostAgentRuntime(): Adapter | undefined {
  const parsed = adapterSchema.safeParse(process.env.ORACULUM_AGENT_RUNTIME);
  return parsed.success ? parsed.data : undefined;
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
