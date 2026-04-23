import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";

import { type ProjectConfig, projectConfigSchema } from "../../../domain/config.js";
import { pathExists } from "../../project.js";

export async function loadConsultationPlanBaseConfig(
  fallbackConfig: ProjectConfig,
  planPath: string,
  options: { consultationPlanFound: boolean },
): Promise<ProjectConfig> {
  if (!options.consultationPlanFound) {
    return fallbackConfig;
  }

  const configPath = join(dirname(planPath), "consultation-config.json");
  if (!(await pathExists(configPath))) {
    return fallbackConfig;
  }

  return projectConfigSchema.parse(JSON.parse(await readFile(configPath, "utf8")) as unknown);
}
