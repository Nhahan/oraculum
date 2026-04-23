import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";

import { createOraculumMcpServer } from "./server.js";

export async function runOraculumMcpServer(): Promise<void> {
  const server = createOraculumMcpServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("Oraculum MCP server running on stdio");
}
