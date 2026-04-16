import { readdir, readFile } from "node:fs/promises";

import type { RunManifest } from "../../domain/run.js";

import { pathExists } from "../project.js";
import { parseRunManifestArtifact } from "../run-manifest-artifact.js";
import { RunStore } from "../run-store.js";

export async function listRecentConsultations(cwd: string, limit = 10): Promise<RunManifest[]> {
  const store = new RunStore(cwd);
  const runsDir = store.runsDir;

  if (!(await pathExists(runsDir))) {
    return [];
  }

  const entries = await readdir(runsDir, { withFileTypes: true });
  const manifests = await Promise.all(
    entries
      .filter((entry) => entry.isDirectory())
      .map(async (entry) => {
        const manifestPath = store.getRunPaths(entry.name).manifestPath;
        if (!(await pathExists(manifestPath))) {
          return undefined;
        }

        try {
          return parseRunManifestArtifact(
            JSON.parse(await readFile(manifestPath, "utf8")) as unknown,
          );
        } catch {
          return undefined;
        }
      }),
  );

  return manifests
    .filter((manifest): manifest is RunManifest => Boolean(manifest))
    .sort((left, right) => {
      const timeDelta = new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime();
      if (timeDelta !== 0) {
        return timeDelta;
      }

      return right.id.localeCompare(left.id);
    })
    .slice(0, limit);
}
