import { readdir, readFile, stat } from "node:fs/promises";

import type { RunManifest } from "../../domain/run.js";

import { pathExists } from "../project.js";
import { parseRunManifestArtifact } from "../run-manifest-artifact.js";
import { RunStore } from "../run-store.js";

export interface InvalidConsultationRecord {
  id: string;
  invalid: true;
  manifestPath: string;
  observedAt: string;
  diagnostic: {
    path: string;
    kind: "run-manifest";
    status: "invalid";
    message: string;
  };
}

export type ConsultationArchiveRecord = RunManifest | InvalidConsultationRecord;

export async function listRecentConsultations(cwd: string, limit = 10): Promise<RunManifest[]> {
  const records = await listRecentConsultationRecords(cwd, limit);
  return records.filter((record): record is RunManifest => !isInvalidConsultationRecord(record));
}

export async function listRecentConsultationRecords(
  cwd: string,
  limit = 10,
): Promise<ConsultationArchiveRecord[]> {
  const store = new RunStore(cwd);
  const runsDir = store.runsDir;

  if (!(await pathExists(runsDir))) {
    return [];
  }

  const entries = await readdir(runsDir, { withFileTypes: true });
  const records = await Promise.all(
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
        } catch (error) {
          return buildInvalidConsultationRecord(entry.name, manifestPath, error);
        }
      }),
  );

  return records
    .filter((record): record is ConsultationArchiveRecord => Boolean(record))
    .sort((left, right) => {
      const timeDelta = getRecordTimestamp(right) - getRecordTimestamp(left);
      if (timeDelta !== 0) {
        return timeDelta;
      }

      return right.id.localeCompare(left.id);
    })
    .slice(0, limit);
}

export function isInvalidConsultationRecord(
  record: ConsultationArchiveRecord,
): record is InvalidConsultationRecord {
  return "invalid" in record && record.invalid === true;
}

async function buildInvalidConsultationRecord(
  id: string,
  manifestPath: string,
  error: unknown,
): Promise<InvalidConsultationRecord> {
  const observedAt = await stat(manifestPath)
    .then((stats) => stats.mtime.toISOString())
    .catch(() => new Date().toISOString());
  return {
    id,
    invalid: true,
    manifestPath,
    observedAt,
    diagnostic: {
      path: manifestPath,
      kind: "run-manifest",
      status: "invalid",
      message: formatUnknownError(error),
    },
  };
}

function getRecordTimestamp(record: ConsultationArchiveRecord): number {
  return new Date(
    isInvalidConsultationRecord(record) ? record.observedAt : record.createdAt,
  ).getTime();
}

function formatUnknownError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
