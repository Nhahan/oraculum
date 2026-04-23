import { commandManifestEntrySchema } from "../../domain/chat-native.js";

const planningArguments = [
  {
    name: "taskInput",
    kind: "string",
    description: "Inline task text, a task note path, or a task packet path.",
    required: true,
    positional: true,
    variadic: true,
  },
] as const;

const consultArguments = [
  {
    name: "taskInput",
    kind: "string",
    description:
      "Optional inline task text or task/consultation-plan path. When omitted, resume the latest running consultation or execute the latest ready consultation plan.",
    required: false,
    positional: true,
    variadic: true,
  },
] as const;

export const oraculumCommandManifest = [
  {
    id: "consult",
    actionId: "consult",
    prefix: "orc",
    path: ["consult"],
    summary: "Run the full consultation tournament and return the completed verdict state.",
    requestShape: "consultActionRequestSchema",
    responseShape: "consultActionResponseSchema",
    arguments: consultArguments,
    examples: [
      "orc consult",
      'orc consult "fix session loss on refresh"',
      "orc consult .oraculum/runs/run_20260404_xxxx/reports/consultation-plan.json",
    ],
    hostAdditions: {},
  },
  {
    id: "plan",
    actionId: "plan",
    prefix: "orc",
    path: ["plan"],
    summary: "Shape a consultation first and persist reusable planning artifacts.",
    requestShape: "planActionRequestSchema",
    responseShape: "planActionResponseSchema",
    arguments: planningArguments,
    examples: ['orc plan "fix session loss on refresh"'],
    hostAdditions: {},
  },
  {
    id: "verdict",
    actionId: "verdict",
    prefix: "orc",
    path: ["verdict"],
    summary: "Reopen the latest verdict or inspect a specific consultation.",
    requestShape: "verdictActionRequestSchema",
    responseShape: "verdictActionResponseSchema",
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
    id: "crown",
    actionId: "crown",
    prefix: "orc",
    path: ["crown"],
    summary: "Crown the recommended result and materialize it in the project.",
    requestShape: "crownActionRequestInputSchema",
    responseShape: "crownActionResponseSchema",
    arguments: [
      {
        name: "materializationName",
        kind: "string",
        description:
          "Branch name to create, or an optional workspace-sync materialization label in non-Git projects.",
        required: false,
        positional: true,
      },
      {
        name: "allowUnsafe",
        kind: "boolean",
        description:
          "Explicitly bypass crown safety blockers such as validation gaps, fallback-policy selection, or manual-review second-opinion status.",
        option: "--allow-unsafe",
      },
    ],
    examples: ["orc crown fix/session-loss", "orc crown", "orc crown --allow-unsafe"],
    hostAdditions: {},
  },
].map((entry) => commandManifestEntrySchema.parse(entry));
