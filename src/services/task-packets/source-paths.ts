import { dirname, isAbsolute, normalize, resolve as resolvePath } from "node:path";

import { type MaterializedTaskPacket, materializedTaskPacketSchema } from "../../domain/task.js";

export function canonicalizeMaterializedTaskPacketSource(
  taskPath: string,
  taskPacket: MaterializedTaskPacket,
): MaterializedTaskPacket {
  const normalizedSourcePath = resolveTaskPacketSourcePath(taskPath, taskPacket.source.path);
  const normalizedOriginPath = taskPacket.source.originPath
    ? resolveTaskPacketSourcePath(taskPath, taskPacket.source.originPath)
    : undefined;

  return materializedTaskPacketSchema.parse({
    ...taskPacket,
    source: {
      ...taskPacket.source,
      path: normalizedSourcePath,
      ...(normalizedOriginPath ? { originPath: normalizedOriginPath } : {}),
    },
  });
}

export function resolveTaskPacketSourcePath(taskPath: string, sourcePath: string): string {
  if (isAbsolute(sourcePath)) {
    return normalize(sourcePath);
  }

  return normalize(resolvePath(dirname(taskPath), sourcePath));
}

export function dedupeStrings(values: string[]): string[] {
  return [...new Set(values)];
}
