export function classifyPublishedSmokePrompt(
  prompt: string,
): "preflight" | "profile" | "winner" | "candidate" | "read-only";

export function shouldPublishedSmokeMutateWorkspace(prompt: string): boolean;

export function buildPublishedSmokeFakeCodexSource(): string;
