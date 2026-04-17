import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

import type { AgentAdapter } from "../../src/adapters/types.js";
import { getProfileSelectionPath, getReportsDir } from "../../src/core/paths.js";
import {
  type AgentProfileRecommendation,
  agentProfileRecommendationSchema,
} from "../../src/domain/profile.js";
import { recommendConsultationProfile } from "../../src/services/consultation-profile.js";
import {
  initializeProject,
  loadProjectConfig,
  loadProjectConfigLayers,
} from "../../src/services/project.js";
import { loadTaskPacket } from "../../src/services/task-packets.js";
import { createTempRootHarness } from "./fs.js";

const tempRootHarness = createTempRootHarness("oraculum-profile-");

export function registerConsultationProfileTempRootCleanup(): void {
  tempRootHarness.registerCleanup();
}

export async function createTempRoot(): Promise<string> {
  return tempRootHarness.createTempRoot();
}

export async function initializeConsultationProfileProject(options?: {
  taskBody?: string;
  taskRelativePath?: string;
}): Promise<{ cwd: string; taskPath: string }> {
  const cwd = await createTempRoot();
  await initializeProject({ cwd, force: false });
  const taskRelativePath = options?.taskRelativePath ?? join("tasks", "fix.md");
  const taskPath = join(cwd, taskRelativePath);
  await mkdir(dirname(taskPath), { recursive: true });
  await writeFile(taskPath, options?.taskBody ?? "# Fix\nKeep it small.\n", "utf8");
  return { cwd, taskPath };
}

export async function recommendFallbackProfile(options: {
  cwd: string;
  runId: string;
  taskPath?: string;
  allowRuntime?: boolean;
  adapter?: AgentAdapter;
}): Promise<Awaited<ReturnType<typeof recommendConsultationProfile>>> {
  const taskPath = options.taskPath ?? join(options.cwd, "tasks", "fix.md");
  const reportsDir = getReportsDir(options.cwd, options.runId);
  await mkdir(reportsDir, { recursive: true });
  return recommendConsultationProfile({
    adapter: options.adapter ?? createNoopProfileAdapter(undefined),
    allowRuntime: options.allowRuntime ?? false,
    baseConfig: await loadProjectConfig(options.cwd),
    configLayers: await loadProjectConfigLayers(options.cwd),
    projectRoot: options.cwd,
    reportsDir,
    runId: options.runId,
    taskPacket: await loadTaskPacket(taskPath),
  });
}

export async function recommendRuntimeProfile(options: {
  cwd: string;
  runId: string;
  recommendation: AgentProfileRecommendation | Record<string, unknown>;
  taskPath?: string;
  onRecommendProfile?: () => void;
}): Promise<Awaited<ReturnType<typeof recommendConsultationProfile>>> {
  const taskPath = options.taskPath ?? join(options.cwd, "tasks", "fix.md");
  const reportsDir = getReportsDir(options.cwd, options.runId);
  await mkdir(reportsDir, { recursive: true });
  return recommendConsultationProfile({
    adapter: createNoopProfileAdapter(options.recommendation, options.onRecommendProfile),
    allowRuntime: true,
    baseConfig: await loadProjectConfig(options.cwd),
    configLayers: await loadProjectConfigLayers(options.cwd),
    projectRoot: options.cwd,
    reportsDir,
    runId: options.runId,
    taskPacket: await loadTaskPacket(taskPath),
  });
}

export async function readProfileSelectionArtifact<T>(cwd: string, runId: string): Promise<T> {
  return JSON.parse(await readFile(getProfileSelectionPath(cwd, runId), "utf8")) as T;
}

export async function writeLibraryPackage(cwd: string): Promise<void> {
  await writeFile(
    join(cwd, "package.json"),
    `${JSON.stringify(
      {
        name: "demo-library",
        packageManager: "npm@10.0.0",
        type: "module",
        main: "dist/index.js",
        exports: "./dist/index.js",
        scripts: {
          lint: 'node -e "process.exit(0)"',
          typecheck: 'node -e "process.exit(0)"',
          test: 'node -e "process.exit(0)"',
        },
      },
      null,
      2,
    )}\n`,
    "utf8",
  );
}

export async function writeFrontendPackage(cwd: string): Promise<void> {
  await writeFile(
    join(cwd, "package.json"),
    `${JSON.stringify(
      {
        name: "demo-frontend",
        packageManager: "npm@10.0.0",
        type: "module",
        dependencies: {
          react: "^19.0.0",
          "@playwright/test": "^1.55.0",
        },
        scripts: {
          lint: 'node -e "process.exit(0)"',
          typecheck: 'node -e "process.exit(0)"',
          build: 'node -e "process.exit(0)"',
        },
      },
      null,
      2,
    )}\n`,
    "utf8",
  );
  await writeFile(join(cwd, "playwright.config.ts"), "export default {};\n", "utf8");
}

export async function writePrismaMigrationPackage(cwd: string): Promise<void> {
  await mkdir(join(cwd, "prisma", "migrations"), { recursive: true });
  await writeFile(
    join(cwd, "package.json"),
    `${JSON.stringify(
      {
        name: "demo-migration",
        packageManager: "npm@10.0.0",
        type: "module",
        dependencies: {
          prisma: "^6.0.0",
          "@prisma/client": "^6.0.0",
        },
        scripts: {
          lint: 'node -e "process.exit(0)"',
          typecheck: 'node -e "process.exit(0)"',
        },
      },
      null,
      2,
    )}\n`,
    "utf8",
  );
  await writeFile(
    join(cwd, "prisma", "schema.prisma"),
    'generator client { provider = "prisma-client-js" }\n' +
      'datasource db { provider = "sqlite" url = "file:dev.db" }\n' +
      "model User { id Int @id }\n",
    "utf8",
  );
  await writeFile(
    join(cwd, "prisma", "migrations", "README.md"),
    "placeholder migration history\n",
    "utf8",
  );
}

export function createNoopProfileAdapter(
  recommendation: AgentProfileRecommendation | Record<string, unknown> | undefined,
  onRecommendProfile?: () => void,
): AgentAdapter {
  const normalizedRecommendation = recommendation
    ? agentProfileRecommendationSchema.parse(recommendation)
    : undefined;
  return {
    name: "codex",
    async runCandidate() {
      throw new Error("not used");
    },
    async recommendPreflight() {
      throw new Error("not used");
    },
    async recommendClarifyFollowUp() {
      throw new Error("not used");
    },
    async recommendWinner() {
      throw new Error("not used");
    },
    async recommendProfile(request) {
      onRecommendProfile?.();
      return {
        runId: request.runId,
        adapter: "codex",
        status: normalizedRecommendation ? "completed" : "failed",
        startedAt: "2026-04-07T00:00:00.000Z",
        completedAt: "2026-04-07T00:00:01.000Z",
        exitCode: normalizedRecommendation ? 0 : 1,
        summary: normalizedRecommendation
          ? "Profile recommendation completed."
          : "Profile recommendation skipped.",
        ...(normalizedRecommendation ? { recommendation: normalizedRecommendation } : {}),
        artifacts: [],
      };
    },
  };
}
