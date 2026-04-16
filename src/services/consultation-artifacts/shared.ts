export function toPortableRelativePath(path: string): string {
  return path.replaceAll("\\", "/");
}

export function toPreservedAbsolutePath(path: string, normalizedPath: string): string {
  return path.includes("\\") ? normalizedPath : normalizedPath.replaceAll("\\", "/");
}

export function hasArtifactRunId(value: unknown): value is { runId: string } {
  if (!value || typeof value !== "object") {
    return false;
  }

  const candidate = value as Record<string, unknown>;
  return typeof candidate.runId === "string" && candidate.runId.length > 0;
}

export function extractComparisonMarkdownRunId(content: string): string | undefined {
  const match = content.match(/^- Run:\s*(.+?)\s*$/m);
  return match?.[1]?.trim() || undefined;
}
