import { mkdir, readFile, stat, writeFile } from "node:fs/promises";

import { OraculumError } from "../core/errors.js";
import {
  getConfigPath,
  getOraculumDir,
  getRunsDir,
  getTasksDir,
  resolveProjectRoot,
} from "../core/paths.js";
import { defaultProjectConfig, type ProjectConfig, projectConfigSchema } from "../domain/config.js";

interface InitializeProjectOptions {
  cwd: string;
  force: boolean;
}

export interface InitializeProjectResult {
  projectRoot: string;
  configPath: string;
  createdPaths: string[];
}

export async function initializeProject(
  options: InitializeProjectOptions,
): Promise<InitializeProjectResult> {
  const projectRoot = resolveProjectRoot(options.cwd);
  const oraculumDir = getOraculumDir(projectRoot);
  const runsDir = getRunsDir(projectRoot);
  const tasksDir = getTasksDir(projectRoot);
  const configPath = getConfigPath(projectRoot);

  if (!options.force && (await pathExists(configPath))) {
    throw new OraculumError(
      `Refusing to overwrite existing config at ${configPath}. Re-run with --force to replace it.`,
    );
  }

  await mkdir(oraculumDir, { recursive: true });
  await mkdir(runsDir, { recursive: true });
  await mkdir(tasksDir, { recursive: true });
  await writeJsonFile(configPath, defaultProjectConfig);

  return {
    projectRoot,
    configPath,
    createdPaths: [oraculumDir, runsDir, tasksDir],
  };
}

export async function loadProjectConfig(cwd: string): Promise<ProjectConfig> {
  const projectRoot = resolveProjectRoot(cwd);
  const configPath = getConfigPath(projectRoot);

  if (!(await pathExists(configPath))) {
    throw new OraculumError(
      `Missing ${configPath}. Run "oraculum init" from the project root first.`,
    );
  }

  const raw = await readFile(configPath, "utf8");
  const parsed = JSON.parse(raw) as unknown;

  return projectConfigSchema.parse(parsed);
}

export async function pathExists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

export async function writeJsonFile(path: string, value: unknown): Promise<void> {
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}
