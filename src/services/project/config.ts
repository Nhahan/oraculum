import { readFile } from "node:fs/promises";

import { OraculumError } from "../../core/errors.js";
import { getAdvancedConfigPath, getConfigPath, resolveProjectRoot } from "../../core/paths.js";
import {
  defaultProjectConfig,
  projectAdvancedConfigSchema,
  projectConfigSchema,
  projectQuickConfigSchema,
} from "../../domain/config.js";
import { pathExists } from "./files.js";
import type { ProjectConfigLayers } from "./types.js";

export async function loadProjectConfig(cwd: string): Promise<ProjectConfigLayers["config"]> {
  return (await loadProjectConfigLayers(cwd)).config;
}

export async function loadProjectConfigLayers(cwd: string): Promise<ProjectConfigLayers> {
  const projectRoot = resolveProjectRoot(cwd);
  const configPath = getConfigPath(projectRoot);
  const advancedConfigPath = getAdvancedConfigPath(projectRoot);

  if (!(await pathExists(configPath))) {
    throw new OraculumError(
      `Missing ${configPath}. Run "orc init" after setup from the project root first.`,
    );
  }

  const raw = await readFile(configPath, "utf8");
  const parsed = JSON.parse(raw) as unknown;
  const advanced = (await pathExists(advancedConfigPath))
    ? projectAdvancedConfigSchema.parse(
        JSON.parse(await readFile(advancedConfigPath, "utf8")) as unknown,
      )
    : undefined;

  const legacyParse = projectConfigSchema.safeParse({
    ...(parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {}),
    repair:
      parsed && typeof parsed === "object" && !Array.isArray(parsed) && "repair" in parsed
        ? (parsed as Record<string, unknown>).repair
        : defaultProjectConfig.repair,
  });
  if (legacyParse.success) {
    return {
      projectRoot,
      quick: {},
      usesLegacyConfig: true,
      ...(advanced ? { advanced } : {}),
      config: projectConfigSchema.parse({
        ...legacyParse.data,
        ...(advanced?.adapters ? { adapters: advanced.adapters } : {}),
        ...(advanced?.strategies ? { strategies: advanced.strategies } : {}),
        ...(advanced?.rounds ? { rounds: advanced.rounds } : {}),
        ...(advanced?.oracles ? { oracles: advanced.oracles } : {}),
        ...(advanced?.repair ? { repair: advanced.repair } : {}),
        ...(advanced?.judge ? { judge: advanced.judge } : {}),
        ...(advanced?.managedTree ? { managedTree: advanced.managedTree } : {}),
      }),
    };
  }

  const quick = projectQuickConfigSchema.parse(parsed);

  return {
    projectRoot,
    quick,
    usesLegacyConfig: false,
    ...(advanced ? { advanced } : {}),
    config: projectConfigSchema.parse({
      ...defaultProjectConfig,
      ...(quick.defaultAgent ? { defaultAgent: quick.defaultAgent } : {}),
      ...(quick.defaultCandidates !== undefined
        ? { defaultCandidates: quick.defaultCandidates }
        : {}),
      ...(advanced?.adapters ? { adapters: advanced.adapters } : {}),
      ...(advanced?.strategies ? { strategies: advanced.strategies } : {}),
      ...(advanced?.rounds ? { rounds: advanced.rounds } : {}),
      ...(advanced?.oracles ? { oracles: advanced.oracles } : {}),
      ...(advanced?.repair ? { repair: advanced.repair } : {}),
      ...(advanced?.judge ? { judge: advanced.judge } : {}),
      ...(advanced?.managedTree ? { managedTree: advanced.managedTree } : {}),
    }),
  };
}
