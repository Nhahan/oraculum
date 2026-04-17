import { readFile } from "node:fs/promises";

import { OraculumError } from "../../core/errors.js";
import { latestRunStateSchema } from "../../domain/run.js";
import { pathExists, writeJsonFile } from "../project.js";
import type { RunPathStore } from "./paths.js";

export class LatestRunStateStore {
  readonly paths: RunPathStore;

  constructor(paths: RunPathStore) {
    this.paths = paths;
  }

  async writeLatestRunState(runId: string): Promise<void> {
    await this.writeLatestState(this.paths.latestRunStatePath, runId);
  }

  async writeLatestExportableRunState(runId: string): Promise<void> {
    await this.writeLatestState(this.paths.latestExportableRunStatePath, runId);
  }

  async readLatestRunId(): Promise<string> {
    return this.readLatestState(
      this.paths.latestRunStatePath,
      "No previous consultation found. Start with `orc consult ...` after setup.",
    );
  }

  async readLatestExportableRunId(): Promise<string> {
    return this.readLatestState(
      this.paths.latestExportableRunStatePath,
      "No crownable consultation found yet. Complete a consultation with a recommended result first.",
    );
  }

  private async writeLatestState(path: string, runId: string): Promise<void> {
    await writeJsonFile(
      path,
      latestRunStateSchema.parse({
        runId,
        updatedAt: new Date().toISOString(),
      }),
    );
  }

  private async readLatestState(path: string, missingMessage: string): Promise<string> {
    if (!(await pathExists(path))) {
      throw new OraculumError(missingMessage);
    }

    const parsed = latestRunStateSchema.parse(JSON.parse(await readFile(path, "utf8")) as unknown);
    return parsed.runId;
  }
}
