import { readFile } from "node:fs/promises";
import { extname } from "node:path";

import {
  deriveTaskPacketId,
  extractTaskTitle,
  type MaterializedTaskPacket,
  materializedTaskPacketSchema,
  taskPacketSchema,
} from "../domain/task.js";

export async function loadTaskPacket(taskPath: string): Promise<MaterializedTaskPacket> {
  const content = await readFile(taskPath, "utf8");
  const extension = extname(taskPath).toLowerCase();

  if (extension === ".json") {
    const parsed = JSON.parse(content) as unknown;
    const withSource = materializedTaskPacketSchema.safeParse(parsed);
    if (withSource.success) {
      return withSource.data;
    }

    const taskPacket = taskPacketSchema.parse(parsed);
    return materializedTaskPacketSchema.parse({
      ...taskPacket,
      source: {
        kind: "task-packet",
        path: taskPath,
      },
    });
  }

  return materializedTaskPacketSchema.parse({
    id: deriveTaskPacketId(taskPath),
    title: extractTaskTitle(taskPath, content),
    intent: content.trim(),
    nonGoals: [],
    acceptanceCriteria: [],
    risks: [],
    oracleHints: [],
    strategyHints: [],
    contextFiles: [],
    source: {
      kind: "task-note",
      path: taskPath,
    },
  });
}
