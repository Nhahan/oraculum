import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";

import { APP_NAME, APP_VERSION } from "../core/constants.js";
import {
  consultToolRequestSchema,
  consultToolResponseSchema,
  crownToolRequestSchema,
  crownToolResponseSchema,
  draftToolRequestSchema,
  draftToolResponseSchema,
  initToolRequestSchema,
  initToolResponseSchema,
  setupStatusToolRequestSchema,
  setupStatusToolResponseSchema,
  verdictArchiveToolRequestSchema,
  verdictArchiveToolResponseSchema,
  verdictToolRequestSchema,
  verdictToolResponseSchema,
} from "../domain/chat-native.js";
import {
  runConsultTool,
  runCrownTool,
  runDraftTool,
  runInitTool,
  runSetupStatusTool,
  runVerdictArchiveTool,
  runVerdictTool,
} from "./mcp-tools.js";

export function createOraculumMcpServer(): McpServer {
  const server = new McpServer(
    { name: APP_NAME, version: APP_VERSION },
    {
      instructions:
        "Use Oraculum to run consultations, reopen verdicts, and crown survivors. Prefer the shared `orc` command language over ad-hoc shell execution.",
    },
  );

  server.registerTool(
    "oraculum_consult",
    {
      title: "Oraculum Consult",
      description:
        "Run the full consultation tournament, execute candidates, and return the completed verdict state.",
      inputSchema: consultToolRequestSchema,
      outputSchema: consultToolResponseSchema,
    },
    async (request) => {
      const response = await runConsultTool(request);
      return {
        content: [{ type: "text", text: response.summary }],
        structuredContent: response,
      };
    },
  );

  server.registerTool(
    "oraculum_draft",
    {
      title: "Oraculum Draft",
      description: "Stage a consultation without executing candidates.",
      inputSchema: draftToolRequestSchema,
      outputSchema: draftToolResponseSchema,
    },
    async (request) => {
      const response = await runDraftTool(request);
      return {
        content: [{ type: "text", text: response.summary }],
        structuredContent: response,
      };
    },
  );

  server.registerTool(
    "oraculum_verdict",
    {
      title: "Oraculum Verdict",
      description: "Reopen the latest or a specific consultation.",
      inputSchema: verdictToolRequestSchema,
      outputSchema: verdictToolResponseSchema,
    },
    async (request) => {
      const response = await runVerdictTool(request);
      return {
        content: [{ type: "text", text: response.summary }],
        structuredContent: response,
      };
    },
  );

  server.registerTool(
    "oraculum_verdict_archive",
    {
      title: "Oraculum Verdict Archive",
      description: "List recent consultations in machine-readable form.",
      inputSchema: verdictArchiveToolRequestSchema,
      outputSchema: verdictArchiveToolResponseSchema,
    },
    async (request) => {
      const response = await runVerdictArchiveTool(request);
      return {
        content: [{ type: "text", text: response.archive }],
        structuredContent: response,
      };
    },
  );

  server.registerTool(
    "oraculum_crown",
    {
      title: "Oraculum Crown",
      description: "Crown the recommended or explicitly selected survivor.",
      inputSchema: crownToolRequestSchema,
      outputSchema: crownToolResponseSchema,
    },
    async (request) => {
      const response = await runCrownTool(request);
      return {
        content: [
          {
            type: "text",
            text: [
              `Crowned ${response.plan.winnerId}`,
              `Consultation: ${response.plan.runId}`,
              `Branch: ${response.plan.branchName}`,
              ...(response.materialization.currentBranch
                ? [`Current branch: ${response.materialization.currentBranch}`]
                : []),
              `Changed paths: ${response.materialization.changedPathCount}`,
              `Post-checks: ${response.materialization.checks.length} passed`,
              "The survivor patch has already been materialized; do not apply it again.",
              `Crowning record: ${response.recordPath}`,
            ].join("\n"),
          },
        ],
        structuredContent: response,
      };
    },
  );

  server.registerTool(
    "oraculum_init",
    {
      title: "Oraculum Init",
      description: "Initialize the quick-start scaffold explicitly.",
      inputSchema: initToolRequestSchema,
      outputSchema: initToolResponseSchema,
    },
    async (request) => {
      const response = await runInitTool(request);
      return {
        content: [
          {
            type: "text",
            text: `Initialized Oraculum in ${response.initialization.projectRoot}`,
          },
        ],
        structuredContent: response,
      };
    },
  );

  server.registerTool(
    "oraculum_setup_status",
    {
      title: "Oraculum Setup Status",
      description: "Inspect host registration diagnostics for chat-native setup.",
      inputSchema: setupStatusToolRequestSchema,
      outputSchema: setupStatusToolResponseSchema,
    },
    async (request) => {
      const response = await runSetupStatusTool(request);
      return {
        content: [{ type: "text", text: response.summary }],
        structuredContent: response,
      };
    },
  );

  return server;
}

export async function runOraculumMcpServer(): Promise<void> {
  const server = createOraculumMcpServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("Oraculum MCP server running on stdio");
}
