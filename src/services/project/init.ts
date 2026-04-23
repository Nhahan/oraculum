import { mkdir, rm } from "node:fs/promises";

import { OraculumError } from "../../core/errors.js";
import {
  getAdvancedConfigPath,
  getConfigPath,
  getGeneratedTasksDir,
  getOraculumDir,
  getRunsDir,
  getTasksDir,
  resolveProjectRoot,
} from "../../core/paths.js";
import {
  type Adapter,
  defaultQuickProjectConfig,
  projectQuickConfigSchema,
} from "../../domain/config.js";
import { pathExists, writeJsonFile } from "./files.js";
import type { InitializeProjectResult } from "./types.js";

interface InitializeProjectOptions {
  cwd: string;
  defaultAgent?: Adapter;
  force: boolean;
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
