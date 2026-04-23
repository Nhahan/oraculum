import type {
  ProjectAdvancedConfig,
  ProjectConfig,
  ProjectQuickConfig,
} from "../../domain/config.js";

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
