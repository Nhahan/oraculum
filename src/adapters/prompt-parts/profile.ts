import { profileStrategyIds } from "../../domain/profile.js";
import type { AgentProfileRequest } from "../types.js";
import {
  appendArtifactIntentContext,
  appendResearchBriefDecisionRules,
  appendResearchSignalDriftContext,
  appendResultIntentContext,
  appendStructuredResearchContext,
  appendTaskSourceContext,
  formatProfileCommandCandidate,
} from "./shared.js";

export function buildProfileSelectionPrompt(request: AgentProfileRequest): string {
  const strategyList = profileStrategyIds.join(", ");
  const sections: string[] = [
    "You are selecting the best Oraculum consultation validation posture for the current repository.",
    "Choose exactly one currently supported validation posture option and synthesize the strongest default tournament settings for this consultation.",
    "Only choose command ids from the provided command catalog. Do not invent commands or command ids.",
    `Choose strategy IDs only from: ${strategyList}.`,
    "Treat validationProfileId as the canonical validation posture field for default tournament settings, not as a claim about the whole repository.",
    "Legacy aliases profileId, summary, and missingCapabilities are accepted for compatibility, but prefer validationProfileId, validationSummary, and validationGaps.",
    "Treat the supported validation posture options below as a compatibility layer for current default bundles, not as a complete repository taxonomy.",
    'Use validationProfileId "generic" when the repository has no strong command-grounded or repo-local profile evidence.',
    'Return JSON only in this shape: {"validationProfileId":"generic","confidence":"low","validationSummary":"short rationale","candidateCount":3,"strategyIds":["minimal-change","safety-first"],"selectedCommandIds":[],"validationGaps":["none or short notes"]}',
    "",
    `Task ID: ${request.taskPacket.id}`,
    `Task Title: ${request.taskPacket.title}`,
    `Task Source: ${request.taskPacket.source.kind} (${request.taskPacket.source.path})`,
    "",
    "Intent:",
    request.taskPacket.intent,
  ];

  appendResultIntentContext(sections, request.taskPacket);
  appendArtifactIntentContext(sections, request.taskPacket);
  appendTaskSourceContext(sections, request.taskPacket);
  appendStructuredResearchContext(sections, request.taskPacket);
  appendResearchSignalDriftContext(
    sections,
    request.taskPacket,
    request.signals.capabilities.map((capability) => `${capability.kind}:${capability.value}`),
  );

  if (request.taskPacket.acceptanceCriteria.length > 0) {
    sections.push(
      "",
      "Acceptance criteria:",
      ...request.taskPacket.acceptanceCriteria.map((item) => `- ${item}`),
    );
  }

  sections.push(
    "",
    "Supported validation posture options:",
    ...request.validationPostureOptions.map((option) => `- ${option.id}: ${option.description}`),
    "",
    `Detected package manager: ${request.signals.packageManager}`,
    `Detected scripts: ${request.signals.scripts.join(", ") || "none"}`,
    `Detected notable files: ${request.signals.files.join(", ") || "none"}`,
    `Detected workspace roots: ${request.signals.workspaceRoots.join(", ") || "none"}`,
    `Detected workspace metadata: ${request.signals.workspaceMetadata.map((workspace) => `${workspace.label} (${workspace.root})`).join(", ") || "none"}`,
    `Detected dependencies: ${request.signals.dependencies.slice(0, 20).join(", ") || "none"}`,
  );

  if (request.signals.capabilities.length > 0) {
    sections.push(
      "",
      "Detected capabilities:",
      ...request.signals.capabilities.map((capability) =>
        [
          `- ${capability.kind}:${capability.value}`,
          `source=${capability.source}`,
          `confidence=${capability.confidence}`,
          ...(capability.path ? [`path=${capability.path}`] : []),
          ...(capability.detail ? [`detail=${capability.detail}`] : []),
        ].join(" "),
      ),
    );
  }

  if (request.signals.notes.length > 0) {
    sections.push("", "Repository notes:", ...request.signals.notes.map((note) => `- ${note}`));
  }

  sections.push("", "Command catalog:");
  for (const candidate of request.signals.commandCatalog) {
    sections.push(...formatProfileCommandCandidate(candidate));
  }

  if (request.signals.skippedCommandCandidates.length > 0) {
    sections.push("", "Skipped command candidates:");
    for (const candidate of request.signals.skippedCommandCandidates) {
      sections.push(
        `- ${candidate.id}`,
        `  Label: ${candidate.label}`,
        `  Capability: ${candidate.capability}`,
        `  Reason: ${candidate.reason}`,
        `  Detail: ${candidate.detail}`,
      );
    }
  }

  sections.push(
    "",
    "Rules:",
    "- Candidate count should usually be 3 or 4 unless the repository signals strongly suggest otherwise.",
    "- Strategy ids must be chosen from this set: minimal-change, safety-first, test-amplified, structural-refactor.",
    "- Selected command ids must come only from the catalog above.",
    "- Only mention validationGaps for checks that are grounded by the repository: a command in the catalog, a skipped command candidate, or an explicit repo capability signal.",
    "- Do not list theoretical profile-default checks when the repository provides no evidence for them.",
    "- If an expected grounded check is missing, explain that in validationGaps instead of inventing a command.",
    "- Return JSON only.",
  );

  appendResearchBriefDecisionRules(sections, request.taskPacket);

  return `${sections.join("\n")}\n`;
}
