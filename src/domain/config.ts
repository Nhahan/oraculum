import { z } from "zod";

import { CONFIG_VERSION } from "../core/constants.js";

export const adapterSchema = z.enum(["claude-code", "codex"]);
export const roundIdSchema = z.enum(["fast", "impact", "deep"]);
export const oracleScopeSchema = z.enum(["workspace", "project"]);
export const oracleEnforcementSchema = z.enum(["hard", "repairable", "signal"]);
export const oracleConfidenceSchema = z.enum(["low", "medium", "high"]);

export const strategySchema = z.object({
  id: z.string().min(1),
  label: z.string().min(1),
  description: z.string().min(1),
});

export const roundSchema = z.object({
  id: roundIdSchema,
  label: z.string().min(1),
  description: z.string().min(1),
});

export const repoOracleSchema = z.object({
  id: z.string().min(1),
  roundId: roundIdSchema,
  command: z.string().min(1),
  args: z.array(z.string()).default([]),
  shell: z.boolean().optional(),
  invariant: z.string().min(1),
  cwd: oracleScopeSchema.default("workspace"),
  enforcement: oracleEnforcementSchema.default("hard"),
  confidence: oracleConfidenceSchema.default("medium"),
  timeoutMs: z
    .number()
    .int()
    .min(1)
    .max(60 * 60 * 1000)
    .optional(),
  passSummary: z.string().min(1).optional(),
  failureSummary: z.string().min(1).optional(),
  repairHint: z.string().min(1).optional(),
  env: z.record(z.string(), z.string()).default({}),
});

const reservedOracleIdsByRound: Record<RoundId, Set<string>> = {
  fast: new Set(["agent-exit", "artifact-capture"]),
  impact: new Set(["reviewable-output"]),
  deep: new Set(),
};

export const projectConfigSchema = z
  .object({
    version: z.literal(CONFIG_VERSION),
    defaultAgent: adapterSchema,
    defaultCandidates: z.number().int().min(1).max(16),
    adapters: z.array(adapterSchema).min(1),
    strategies: z.array(strategySchema).min(1),
    rounds: z.array(roundSchema).min(1),
    oracles: z.array(repoOracleSchema).default([]),
  })
  .superRefine((config, context) => {
    const seen = new Set<string>();

    for (const [index, oracle] of config.oracles.entries()) {
      const key = `${oracle.roundId}:${oracle.id}`;
      if (seen.has(key)) {
        context.addIssue({
          code: "custom",
          message: `Duplicate repo-local oracle id "${oracle.id}" in round "${oracle.roundId}".`,
          path: ["oracles", index, "id"],
        });
      }
      seen.add(key);

      if (reservedOracleIdsByRound[oracle.roundId].has(oracle.id)) {
        context.addIssue({
          code: "custom",
          message: `Oracle id "${oracle.id}" in round "${oracle.roundId}" is reserved by a built-in oracle.`,
          path: ["oracles", index, "id"],
        });
      }
    }
  });

export type Adapter = z.infer<typeof adapterSchema>;
export type RoundId = z.infer<typeof roundIdSchema>;
export type OracleScope = z.infer<typeof oracleScopeSchema>;
export type OracleEnforcement = z.infer<typeof oracleEnforcementSchema>;
export type OracleConfidence = z.infer<typeof oracleConfidenceSchema>;
export type Strategy = z.infer<typeof strategySchema>;
export type Round = z.infer<typeof roundSchema>;
export type RepoOracle = z.infer<typeof repoOracleSchema>;
export type ProjectConfig = z.infer<typeof projectConfigSchema>;

export const defaultProjectConfig: ProjectConfig = {
  version: CONFIG_VERSION,
  defaultAgent: "claude-code",
  defaultCandidates: 4,
  adapters: ["claude-code", "codex"],
  strategies: [
    {
      id: "minimal-change",
      label: "Minimal Change",
      description: "Aim for the smallest safe diff that satisfies the task.",
    },
    {
      id: "safety-first",
      label: "Safety First",
      description: "Prefer explicit guards and conservative behavior over compactness.",
    },
    {
      id: "test-amplified",
      label: "Test Amplified",
      description: "Strengthen evidence with tests or fixtures before changing behavior.",
    },
    {
      id: "structural-refactor",
      label: "Structural Refactor",
      description: "Pay down local structural debt if it reduces repeated risk.",
    },
  ],
  rounds: [
    {
      id: "fast",
      label: "Fast",
      description: "Cheap deterministic checks and repo-local quick oracles.",
    },
    {
      id: "impact",
      label: "Impact",
      description: "Touched-area integration checks and API-impact review.",
    },
    {
      id: "deep",
      label: "Deep",
      description: "Expensive suites, scenario validation, and release-level checks.",
    },
  ],
  oracles: [],
};
