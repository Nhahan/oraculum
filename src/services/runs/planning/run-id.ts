import { randomUUID } from "node:crypto";

export function createRunId(): string {
  const timestamp = new Date()
    .toISOString()
    .replaceAll(/[-:.TZ]/g, "")
    .slice(0, 14);
  const suffix = randomUUID().slice(0, 8);
  return `run_${timestamp}_${suffix}`;
}
