import type { ProfileRepoSignals } from "../../../domain/profile.js";

import { commandExecutionKey, commandSlotKey, type ProfileCommandSlot } from "../shared.js";
import { FALLBACK_BASELINE_COMMAND_SLOTS } from "./config.js";

export function buildFallbackCommandSlots(): ProfileCommandSlot[] {
  const slots = FALLBACK_BASELINE_COMMAND_SLOTS;
  const seen = new Set<string>();

  return slots.filter((slot) => {
    const key = commandSlotKey(slot);
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
}

export function chooseFallbackCommandIds(
  desiredSlots: ProfileCommandSlot[],
  catalog: ProfileRepoSignals["commandCatalog"],
): string[] {
  const selectedCommandIds: string[] = [];
  const usedExecutionKeys = new Set<string>();

  for (const desiredSlot of desiredSlots) {
    const candidate = catalog.find((command) => {
      const executionKey = commandExecutionKey(command);
      return (
        command.roundId === desiredSlot.roundId &&
        command.capability === desiredSlot.capability &&
        !usedExecutionKeys.has(executionKey)
      );
    });
    if (!candidate) {
      continue;
    }

    selectedCommandIds.push(candidate.id);
    usedExecutionKeys.add(commandExecutionKey(candidate));
  }

  return selectedCommandIds;
}

export function inferGenericFallbackValidationGaps(
  selectedCommandIds: string[],
  catalog: ProfileRepoSignals["commandCatalog"],
): string[] {
  const byId = new Map(catalog.map((candidate) => [candidate.id, candidate]));
  const selectedCommands = selectedCommandIds.flatMap((id) => {
    const candidate = byId.get(id);
    return candidate ? [candidate] : [];
  });
  const selectedSlots = new Set(
    selectedCommands.flatMap((candidate) =>
      candidate.capability ? [commandSlotKey(candidate)] : [],
    ),
  );
  const missing: string[] = [];

  if (selectedSlots.size === 0) {
    const hasRepoLocalValidationCommand = catalog.some(
      (candidate) => candidate.source === "repo-local-script",
    );
    missing.push(
      hasRepoLocalValidationCommand
        ? "No repo-local validation command was selected."
        : "No repo-local validation command was detected.",
    );
  }

  return missing;
}
