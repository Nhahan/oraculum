import { type CommandManifestEntry, commandManifestEntrySchema } from "../../domain/chat-native.js";

export function getOrcRouteAlias(commandId: string): string {
  return commandId;
}

const planningArguments = [
  {
    name: "taskInput",
    kind: "string",
    description: "Inline task text, a task note path, or a task packet path.",
    required: true,
    positional: true,
  },
  {
    name: "agent",
    kind: "string",
    description: "Agent runtime override.",
    option: "--agent",
  },
  {
    name: "candidates",
    kind: "integer",
    description: "Number of candidate variants to plan.",
    option: "--candidates",
  },
  {
    name: "timeoutMs",
    kind: "integer",
    description: "Adapter timeout in milliseconds.",
    option: "--timeout-ms",
  },
] as const;

export const oraculumCommandManifest = [
  {
    id: "consult",
    prefix: "orc",
    path: ["consult"],
    summary: "Run the full consultation tournament and return the completed verdict state.",
    mcpTool: "oraculum_consult",
    requestShape: "consultToolRequestSchema",
    responseShape: "consultToolResponseSchema",
    arguments: planningArguments,
    examples: ['orc consult "fix session loss on refresh"'],
    hostAdditions: {},
  },
  {
    id: "verdict",
    prefix: "orc",
    path: ["verdict"],
    summary: "Reopen the latest verdict or inspect a specific consultation.",
    mcpTool: "oraculum_verdict",
    requestShape: "verdictToolRequestSchema",
    responseShape: "verdictToolResponseSchema",
    arguments: [
      {
        name: "consultationId",
        kind: "string",
        description: "Consultation identifier; defaults to the latest consultation.",
        positional: true,
      },
    ],
    examples: ["orc verdict", "orc verdict run_20260404_xxxx"],
    hostAdditions: {},
  },
  {
    id: "verdict-archive",
    prefix: "orc",
    path: ["verdict", "archive"],
    summary: "Browse recent consultations without reopening one immediately.",
    mcpTool: "oraculum_verdict_archive",
    requestShape: "verdictArchiveToolRequestSchema",
    responseShape: "verdictArchiveToolResponseSchema",
    arguments: [
      {
        name: "count",
        kind: "integer",
        description: "Maximum number of recent consultations to show.",
        positional: true,
      },
    ],
    examples: ["orc verdict archive", "orc verdict archive 20"],
    hostAdditions: {},
  },
  {
    id: "crown",
    prefix: "orc",
    path: ["crown"],
    summary: "Crown the recommended result and materialize it in the project.",
    mcpTool: "oraculum_crown",
    requestShape: "crownToolRequestInputSchema",
    responseShape: "crownToolResponseSchema",
    arguments: [
      {
        name: "materializationName",
        kind: "string",
        description:
          "Branch name to create, or an optional workspace-sync materialization label in non-Git projects.",
        required: false,
        positional: true,
      },
    ],
    examples: ["orc crown fix/session-loss", "orc crown"],
    hostAdditions: {},
  },
  {
    id: "plan",
    prefix: "orc",
    path: ["plan"],
    summary: "Shape a consultation first and persist reusable planning artifacts.",
    mcpTool: "oraculum_plan",
    requestShape: "planToolRequestSchema",
    responseShape: "planToolResponseSchema",
    arguments: planningArguments,
    examples: ['orc plan "fix session loss on refresh"'],
    hostAdditions: {},
  },
  {
    id: "draft",
    prefix: "orc",
    path: ["draft"],
    summary: "Compatibility alias for `orc plan`.",
    mcpTool: "oraculum_draft",
    requestShape: "draftToolRequestSchema",
    responseShape: "draftToolResponseSchema",
    arguments: planningArguments,
    examples: ['orc draft "fix session loss on refresh"'],
    hostAdditions: {},
  },
  {
    id: "init",
    prefix: "orc",
    path: ["init"],
    summary: "Initialize the quick-start scaffold explicitly.",
    mcpTool: "oraculum_init",
    requestShape: "initToolRequestSchema",
    responseShape: "initToolResponseSchema",
    arguments: [
      {
        name: "force",
        kind: "boolean",
        description: "Reset quick-start config and remove advanced overrides.",
        option: "--force",
      },
    ],
    examples: ["orc init", "orc init --force"],
    hostAdditions: {},
  },
].map((entry) => commandManifestEntrySchema.parse(entry));

export const typedOraculumCommandManifest: CommandManifestEntry[] = oraculumCommandManifest;
