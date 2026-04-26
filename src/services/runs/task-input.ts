import { randomUUID } from "node:crypto";
import { extname, resolve } from "node:path";

import { OraculumError } from "../../core/errors.js";
import { getGeneratedTasksDir } from "../../core/paths.js";
import { pathExists, writeTextFileAtomically } from "../project.js";

export async function materializeTaskInput(
  projectRoot: string,
  invocationCwd: string,
  taskInput: string,
  options?: {
    forceInline?: boolean;
  },
): Promise<string> {
  const normalized = taskInput.trim();
  if (!normalized) {
    throw new OraculumError("Task input must not be empty.");
  }

  if (options?.forceInline) {
    return await writeInlineTaskInput(projectRoot, normalized);
  }

  const invocationPath = resolve(invocationCwd, normalized);
  if (await pathExists(invocationPath)) {
    return invocationPath;
  }

  const projectPath = resolve(projectRoot, normalized);
  if (projectPath !== invocationPath && (await pathExists(projectPath))) {
    return projectPath;
  }
  if (looksLikeTaskPath(normalized)) {
    throw new OraculumError(`Task file not found: ${invocationPath}`);
  }

  return await writeInlineTaskInput(projectRoot, normalized);
}

async function writeInlineTaskInput(
  projectRoot: string,
  normalizedTaskInput: string,
): Promise<string> {
  const generatedTasksDir = getGeneratedTasksDir(projectRoot);
  const inlineTaskId = createInlineTaskId(normalizedTaskInput);
  const inlineTaskPath = resolve(generatedTasksDir, `${inlineTaskId}.md`);
  await writeTextFileAtomically(inlineTaskPath, buildInlineTaskNote(normalizedTaskInput));
  return inlineTaskPath;
}

function buildInlineTaskNote(taskInput: string): string {
  const normalized = taskInput.trim();
  if (normalized.startsWith("# ")) {
    return normalized.endsWith("\n") ? normalized : `${normalized}\n`;
  }

  return `# ${buildInlineTaskTitle(normalized)}\n${normalized}\n`;
}

function buildInlineTaskTitle(taskInput: string): string {
  const firstLine = taskInput.split(/\r?\n/u)[0]?.trim() ?? "Inline task";
  const withoutTrailingPunctuation = firstLine.replace(/[.?!]+$/u, "").trim();
  if (withoutTrailingPunctuation) {
    return withoutTrailingPunctuation.slice(0, 80);
  }

  return "Inline task";
}

function createInlineTaskId(taskInput: string): string {
  const label = buildInlineTaskTitle(taskInput)
    .toLowerCase()
    .replaceAll(/[^a-z0-9]+/gu, "-")
    .replaceAll(/^-+|-+$/gu, "");
  return `${label || "task"}-${randomUUID().slice(0, 8)}`;
}

function looksLikeTaskPath(taskInput: string): boolean {
  if (/[\r\n]/u.test(taskInput)) {
    return false;
  }

  const hasWhitespace = /\s/u.test(taskInput);
  if (/^(?:\.{1,2}[\\/]|[A-Za-z]:[\\/]|\/)/u.test(taskInput)) {
    return true;
  }

  return taskInput.startsWith(".") || (!hasWhitespace && extname(taskInput).length > 0);
}
