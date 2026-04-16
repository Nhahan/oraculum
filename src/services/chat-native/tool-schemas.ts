import type { ZodTypeAny } from "zod";

import {
  consultToolRequestSchema,
  consultToolResponseSchema,
  crownToolRequestInputSchema,
  crownToolResponseSchema,
  draftToolRequestSchema,
  draftToolResponseSchema,
  initToolRequestSchema,
  initToolResponseSchema,
  type McpToolId,
  mcpToolIdSchema,
  planToolRequestSchema,
  planToolResponseSchema,
  setupStatusToolRequestSchema,
  setupStatusToolResponseSchema,
  verdictArchiveToolRequestSchema,
  verdictArchiveToolResponseSchema,
  verdictToolRequestSchema,
  verdictToolResponseSchema,
} from "../../domain/chat-native.js";

export const oraculumMcpSchemas = {
  oraculum_consult: {
    request: consultToolRequestSchema,
    response: consultToolResponseSchema,
  },
  oraculum_plan: {
    request: planToolRequestSchema,
    response: planToolResponseSchema,
  },
  oraculum_draft: {
    request: draftToolRequestSchema,
    response: draftToolResponseSchema,
  },
  oraculum_verdict: {
    request: verdictToolRequestSchema,
    response: verdictToolResponseSchema,
  },
  oraculum_verdict_archive: {
    request: verdictArchiveToolRequestSchema,
    response: verdictArchiveToolResponseSchema,
  },
  oraculum_crown: {
    request: crownToolRequestInputSchema,
    response: crownToolResponseSchema,
  },
  oraculum_init: {
    request: initToolRequestSchema,
    response: initToolResponseSchema,
  },
  oraculum_setup_status: {
    request: setupStatusToolRequestSchema,
    response: setupStatusToolResponseSchema,
  },
} satisfies Record<
  McpToolId,
  {
    request: ZodTypeAny;
    response: ZodTypeAny;
  }
>;

export function getMcpToolSchemas(toolId: McpToolId): {
  request: ZodTypeAny;
  response: ZodTypeAny;
} {
  return oraculumMcpSchemas[toolId];
}

export function assertToolId(value: string): McpToolId {
  return mcpToolIdSchema.parse(value);
}
