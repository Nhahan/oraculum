import { type ToolMetadata, toolMetadataSchema } from "../../domain/chat-native.js";

const buildConsultationArtifactsBinding = {
  kind: "new-adapter-layer",
  module: "src/services/chat-native.ts",
  symbol: "buildConsultationArtifacts",
  note: "Machine-readable MCP response assembly layer.",
} as const;

const buildSetupDiagnosticsBinding = {
  kind: "new-adapter-layer",
  module: "src/services/chat-native.ts",
  symbol: "buildSetupDiagnosticsResponse",
  note: "Host registration inspection layer until full setup/install commands land.",
} as const;

const ensureProjectInitializedBinding = {
  kind: "existing-service",
  module: "src/services/project.ts",
  symbol: "ensureProjectInitialized",
} as const;

const executeRunBinding = {
  kind: "existing-service",
  module: "src/services/execution.ts",
  symbol: "executeRun",
} as const;

const initializeProjectBinding = {
  kind: "existing-service",
  module: "src/services/project.ts",
  symbol: "initializeProject",
} as const;

const listRecentConsultationsBinding = {
  kind: "existing-service",
  module: "src/services/consultations.ts",
  symbol: "listRecentConsultations",
} as const;

const materializeExportBinding = {
  kind: "existing-service",
  module: "src/services/exports.ts",
  symbol: "materializeExport",
} as const;

const pathExistsBinding = {
  kind: "existing-service",
  module: "src/services/project.ts",
  symbol: "pathExists",
} as const;

const planRunBinding = {
  kind: "existing-service",
  module: "src/services/runs.ts",
  symbol: "planRun",
} as const;

const readLatestRunManifestBinding = {
  kind: "existing-service",
  module: "src/services/runs.ts",
  symbol: "readLatestRunManifest",
} as const;

const readRunManifestBinding = {
  kind: "existing-service",
  module: "src/services/runs.ts",
  symbol: "readRunManifest",
} as const;

const renderConsultationArchiveBinding = {
  kind: "existing-service",
  module: "src/services/consultations.ts",
  symbol: "renderConsultationArchive",
} as const;

const renderConsultationSummaryBinding = {
  kind: "existing-service",
  module: "src/services/consultations.ts",
  symbol: "renderConsultationSummary",
} as const;

const completedConsultationArtifacts = [
  "run.json",
  "consultation-config.json",
  "consultation-plan.json",
  "consultation-plan.md",
  "preflight-readiness.json",
  "clarify-follow-up.json",
  "research-brief.json",
  "failure-analysis.json",
  "profile-selection.json",
  "comparison.json",
  "comparison.md",
  "winner-selection.json",
  "winner-selection.second-opinion.json",
] as const;

const planningArtifacts = [
  "run.json",
  "consultation-config.json",
  "consultation-plan.json",
  "consultation-plan.md",
  "preflight-readiness.json",
  "clarify-follow-up.json",
  "research-brief.json",
  "profile-selection.json",
] as const;

const verdictArtifacts = [
  "run.json",
  "consultation-config.json",
  "preflight-readiness.json",
  "clarify-follow-up.json",
  "research-brief.json",
  "failure-analysis.json",
  "profile-selection.json",
  "comparison.json",
  "comparison.md",
  "winner-selection.json",
  "winner-selection.second-opinion.json",
  "export-plan.json",
] as const;

export const oraculumMcpToolSurface = [
  {
    id: "oraculum_consult",
    purpose:
      "Start a full consultation, execute candidates, and return the completed verdict state.",
    requestShape: "consultToolRequestSchema",
    responseShape: "consultToolResponseSchema",
    bindings: [
      ensureProjectInitializedBinding,
      planRunBinding,
      executeRunBinding,
      renderConsultationSummaryBinding,
      buildConsultationArtifactsBinding,
    ],
    machineReadableArtifacts: completedConsultationArtifacts,
  },
  {
    id: "oraculum_plan",
    purpose:
      "Plan a consultation without executing candidates and return the persisted consultation-plan artifacts.",
    requestShape: "planToolRequestSchema",
    responseShape: "planToolResponseSchema",
    bindings: [
      ensureProjectInitializedBinding,
      planRunBinding,
      renderConsultationSummaryBinding,
      buildConsultationArtifactsBinding,
    ],
    machineReadableArtifacts: planningArtifacts,
  },
  {
    id: "oraculum_draft",
    purpose:
      "Compatibility alias for planning a consultation without executing candidates and returning the drafted run state.",
    requestShape: "draftToolRequestSchema",
    responseShape: "draftToolResponseSchema",
    bindings: [
      ensureProjectInitializedBinding,
      planRunBinding,
      renderConsultationSummaryBinding,
      buildConsultationArtifactsBinding,
    ],
    machineReadableArtifacts: planningArtifacts,
  },
  {
    id: "oraculum_verdict",
    purpose: "Reopen the latest or a specific consultation and return the saved verdict state.",
    requestShape: "verdictToolRequestSchema",
    responseShape: "verdictToolResponseSchema",
    bindings: [
      readLatestRunManifestBinding,
      readRunManifestBinding,
      renderConsultationSummaryBinding,
      buildConsultationArtifactsBinding,
    ],
    machineReadableArtifacts: verdictArtifacts,
  },
  {
    id: "oraculum_verdict_archive",
    purpose:
      "List recent consultations in machine-readable form for archive browsing and reopen flows.",
    requestShape: "verdictArchiveToolRequestSchema",
    responseShape: "verdictArchiveToolResponseSchema",
    bindings: [listRecentConsultationsBinding, renderConsultationArchiveBinding],
    machineReadableArtifacts: ["run.json"],
  },
  {
    id: "oraculum_crown",
    purpose:
      "Crown the recommended result, or materialize an explicitly selected finalist when a direct tool caller provides candidateId.",
    requestShape: "crownToolRequestInputSchema",
    responseShape: "crownToolResponseSchema",
    bindings: [materializeExportBinding, readRunManifestBinding],
    machineReadableArtifacts: ["export-plan.json", "export.patch", "export-sync.json"],
  },
  {
    id: "oraculum_init",
    purpose: "Initialize the quick-start project scaffold and return the created paths.",
    requestShape: "initToolRequestSchema",
    responseShape: "initToolResponseSchema",
    bindings: [initializeProjectBinding],
    machineReadableArtifacts: ["config.json"],
  },
  {
    id: "oraculum_setup_status",
    purpose:
      "Return setup diagnostics that explain whether host registration is ready for chat-native commands.",
    requestShape: "setupStatusToolRequestSchema",
    responseShape: "setupStatusToolResponseSchema",
    bindings: [pathExistsBinding, buildSetupDiagnosticsBinding],
    machineReadableArtifacts: [],
  },
].map((tool) => toolMetadataSchema.parse(tool));

export const typedOraculumMcpToolSurface: ToolMetadata[] = oraculumMcpToolSurface;
