import type { MaterializedTaskPacket } from "../../src/domain/task.js";
import { createMaterializedTaskPacketFixture } from "./contract-fixtures.js";
import { createTempRootHarness } from "./fs.js";

const tempRootHarness = createTempRootHarness("oraculum-adapters-");

export function registerAdaptersTempRootCleanup(): void {
  tempRootHarness.registerCleanup();
}

export function parseLoggedJson(text: string): unknown {
  const trimmed = text.trim();
  try {
    return JSON.parse(trimmed) as unknown;
  } catch {
    const start = trimmed.indexOf("{");
    const end = trimmed.lastIndexOf("}");
    if (start === -1 || end === -1 || end < start) {
      throw new Error(`Could not find a JSON object in logged text: ${trimmed}`);
    }
    return JSON.parse(trimmed.slice(start, end + 1)) as unknown;
  }
}

export function createTaskPacket(overrides: Partial<MaterializedTaskPacket> = {}) {
  return createMaterializedTaskPacketFixture({
    id: "fix-session-loss",
    title: "Fix session loss",
    intent: "Preserve login state during refresh.",
    source: {
      kind: "task-note",
      path: "/tmp/task.md",
    },
    ...overrides,
  });
}

export function createRepoSignals() {
  return {
    packageManager: "npm" as const,
    scripts: ["lint", "test"],
    dependencies: ["typescript"],
    files: ["package.json", "README.md"],
    workspaceRoots: [],
    workspaceMetadata: [],
    notes: ["Task input is repo-local."],
    capabilities: [
      {
        kind: "command" as const,
        value: "lint",
        source: "root-config" as const,
        confidence: "high" as const,
        detail: "Root lint script is present.",
      },
    ],
    provenance: [],
    skippedCommandCandidates: [],
    commandCatalog: [],
  };
}

export async function createTempRoot(): Promise<string> {
  return tempRootHarness.createTempRoot();
}
