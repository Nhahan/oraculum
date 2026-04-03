import { z } from "zod";

import { CONFIG_VERSION } from "../core/constants.js";

export const adapterSchema = z.enum(["claude-code", "codex"]);

export const strategySchema = z.object({
  id: z.string().min(1),
  label: z.string().min(1),
  description: z.string().min(1),
});

export const roundSchema = z.object({
  id: z.enum(["fast", "impact", "deep"]),
  label: z.string().min(1),
  description: z.string().min(1),
});

export const projectConfigSchema = z.object({
  version: z.literal(CONFIG_VERSION),
  defaultAgent: adapterSchema,
  defaultCandidates: z.number().int().min(1).max(16),
  adapters: z.array(adapterSchema).min(1),
  strategies: z.array(strategySchema).min(1),
  rounds: z.array(roundSchema).min(1),
});

export type Adapter = z.infer<typeof adapterSchema>;
export type Strategy = z.infer<typeof strategySchema>;
export type Round = z.infer<typeof roundSchema>;
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
};
