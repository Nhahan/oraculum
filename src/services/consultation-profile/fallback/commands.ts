import type { ConsultationProfileId, ProfileRepoSignals } from "../../../domain/profile.js";

import { commandExecutionKey, commandSlotKey, type ProfileCommandSlot } from "../shared.js";
import {
  FALLBACK_BASELINE_COMMAND_SLOTS,
  VALIDATION_POSTURE_FALLBACK_ANCHORS,
  VALIDATION_POSTURE_MISSING_CAPABILITY_RULES,
} from "./config.js";

export function buildFallbackCommandSlots(profileId: ConsultationProfileId): ProfileCommandSlot[] {
  const profileAnchors =
    profileId === "frontend" || profileId === "migration"
      ? VALIDATION_POSTURE_FALLBACK_ANCHORS[profileId]
      : [];
  const slots =
    profileId === "generic"
      ? FALLBACK_BASELINE_COMMAND_SLOTS
      : [...FALLBACK_BASELINE_COMMAND_SLOTS, ...profileAnchors];
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

export function inferMissingCapabilities(
  profileId: ConsultationProfileId,
  selectedCommandIds: string[],
  catalog: ProfileRepoSignals["commandCatalog"],
  capabilities: ProfileRepoSignals["capabilities"],
  skippedCommandCandidates: ProfileRepoSignals["skippedCommandCandidates"],
  requireRuntimeEvidence = false,
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
  const selectedExecutionKeys = new Set(selectedCommands.map(commandExecutionKey));
  const hasSelectedSlot = (slot: ProfileCommandSlot) =>
    selectedSlots.has(commandSlotKey(slot)) ||
    catalog.some(
      (candidate) =>
        candidate.roundId === slot.roundId &&
        candidate.capability === slot.capability &&
        selectedExecutionKeys.has(commandExecutionKey(candidate)),
    );
  const hasCatalogSlot = (slot: ProfileCommandSlot) =>
    catalog.some(
      (candidate) => candidate.roundId === slot.roundId && candidate.capability === slot.capability,
    );
  const hasSkippedCapability = (capability: string) =>
    skippedCommandCandidates.some((candidate) => candidate.capability === capability);
  const recordMissing = (options: {
    slots: ProfileCommandSlot[];
    whenDetectedButNotSelected: string;
    whenNotDetected: string;
  }) => {
    if (options.slots.some(hasSelectedSlot)) {
      return;
    }
    missing.push(
      options.slots.some(hasCatalogSlot)
        ? options.whenDetectedButNotSelected
        : options.whenNotDetected,
    );
  };
  const missing: string[] = [];

  if (profileId === "generic" && selectedSlots.size === 0) {
    const hasRepoLocalValidationCommand = catalog.some(
      (candidate) => candidate.source === "repo-local-script",
    );
    missing.push(
      hasRepoLocalValidationCommand
        ? "No repo-local validation command was selected."
        : "No repo-local validation command was detected.",
    );
  }
  if (profileId !== "generic") {
    for (const rule of VALIDATION_POSTURE_MISSING_CAPABILITY_RULES[profileId]) {
      const hasCatalogEvidence = rule.slots.some(hasCatalogSlot);
      const hasSkippedEvidence = rule.slots.some((slot) => hasSkippedCapability(slot.capability));
      if (
        requireRuntimeEvidence &&
        rule.runtimeEvidencePredicate &&
        !rule.runtimeEvidencePredicate({
          capabilities,
          hasCatalogEvidence,
          hasSkippedEvidence,
        })
      ) {
        continue;
      }
      recordMissing(rule);
    }
  }

  return missing;
}
