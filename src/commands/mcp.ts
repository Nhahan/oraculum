import type { Command } from "commander";

import { runOraculumMcpServer } from "../services/mcp-server.js";

export function registerMcpCommand(program: Command): void {
  const mcp = program.command("mcp").description("Internal MCP server commands.");

  mcp
    .command("serve")
    .description("Run the Oraculum MCP server on stdio.")
    .action(async () => {
      await runOraculumMcpServer();
    });
}
