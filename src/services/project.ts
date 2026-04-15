import { existsSync, readFileSync } from "node:fs";
import { lstat, mkdir, readFile, rm, writeFile } from "node:fs/promises";

import { OraculumError } from "../core/errors.js";
import {
  getAdvancedConfigPath,
  getConfigPath,
  getGeneratedTasksDir,
  getOraculumDir,
  getRunsDir,
  getTasksDir,
  resolveProjectRoot,
} from "../core/paths.js";
import {
  type Adapter,
  defaultProjectConfig,
  defaultQuickProjectConfig,
  type ProjectAdvancedConfig,
  type ProjectConfig,
  type ProjectQuickConfig,
  projectAdvancedConfigSchema,
  projectConfigSchema,
  projectQuickConfigSchema,
} from "../domain/config.js";

interface InitializeProjectOptions {
  cwd: string;
  defaultAgent?: Adapter;
  force: boolean;
}

export interface InitializeProjectResult {
  projectRoot: string;
  configPath: string;
  createdPaths: string[];
}

export interface ProjectConfigLayers {
  projectRoot: string;
  config: ProjectConfig;
  quick: ProjectQuickConfig;
  advanced?: ProjectAdvancedConfig;
  usesLegacyConfig: boolean;
}

export async function initializeProject(
  options: InitializeProjectOptions,
): Promise<InitializeProjectResult> {
  const projectRoot = resolveProjectRoot(options.cwd);
  const oraculumDir = getOraculumDir(projectRoot);
  const generatedTasksDir = getGeneratedTasksDir(projectRoot);
  const runsDir = getRunsDir(projectRoot);
  const tasksDir = getTasksDir(projectRoot);
  const configPath = getConfigPath(projectRoot);
  const advancedConfigPath = getAdvancedConfigPath(projectRoot);

  if (!options.force && (await pathExists(configPath))) {
    throw new OraculumError(
      `Refusing to overwrite existing config at ${configPath}. Re-run with --force to replace it.`,
    );
  }

  await mkdir(oraculumDir, { recursive: true });
  await mkdir(generatedTasksDir, { recursive: true });
  await mkdir(runsDir, { recursive: true });
  await mkdir(tasksDir, { recursive: true });
  if (options.force) {
    await rm(advancedConfigPath, { force: true });
  }
  await writeJsonFile(
    configPath,
    projectQuickConfigSchema.parse({
      ...defaultQuickProjectConfig,
      ...(options.defaultAgent ? { defaultAgent: options.defaultAgent } : {}),
    }),
  );

  return {
    projectRoot,
    configPath,
    createdPaths: [oraculumDir, generatedTasksDir, runsDir, tasksDir],
  };
}

export async function ensureProjectInitialized(
  cwd: string,
  options: { defaultAgent?: Adapter } = {},
): Promise<InitializeProjectResult | undefined> {
  const projectRoot = resolveProjectRoot(cwd);
  const configPath = getConfigPath(projectRoot);

  if (await pathExists(configPath)) {
    return undefined;
  }

  return initializeProject({
    cwd: projectRoot,
    ...(options.defaultAgent ? { defaultAgent: options.defaultAgent } : {}),
    force: false,
  });
}

export async function loadProjectConfig(cwd: string): Promise<ProjectConfig> {
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

export async function pathExists(path: string): Promise<boolean> {
  try {
    await lstat(path);
    return true;
  } catch {
    return false;
  }
}

export async function hasNonEmptyTextArtifact(path: string): Promise<boolean> {
  if (!(await pathExists(path))) {
    return false;
  }

  try {
    return (await readFile(path, "utf8")).trim().length > 0;
  } catch {
    return false;
  }
}

export function hasNonEmptyTextArtifactSync(path: string): boolean {
  if (!existsSync(path)) {
    return false;
  }

  try {
    return readFileSync(path, "utf8").trim().length > 0;
  } catch {
    return false;
  }
}

export async function writeJsonFile(path: string, value: unknown): Promise<void> {
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}
