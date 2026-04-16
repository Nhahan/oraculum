import {
  type InitToolRequest,
  type InitToolResponse,
  initToolRequestSchema,
  initToolResponseSchema,
  type SetupStatusToolRequest,
  type SetupStatusToolResponse,
  setupStatusToolRequestSchema,
  setupStatusToolResponseSchema,
} from "../../domain/chat-native.js";

import {
  buildProjectInitializationResult,
  buildSetupDiagnosticsResponse,
  filterSetupDiagnosticsResponse,
} from "../chat-native.js";
import { initializeProject } from "../project.js";

import { resolveHostAgentRuntime } from "./shared.js";

export async function runInitTool(input: InitToolRequest): Promise<InitToolResponse> {
  const request = initToolRequestSchema.parse(input);
  const hostDefaultAgent = resolveHostAgentRuntime();
  const initialization = await initializeProject({
    cwd: request.cwd,
    ...(hostDefaultAgent ? { defaultAgent: hostDefaultAgent } : {}),
    force: request.force,
  });

  return initToolResponseSchema.parse({
    mode: "init",
    initialization: buildProjectInitializationResult(initialization),
  });
}

export async function runSetupStatusTool(
  input: SetupStatusToolRequest,
): Promise<SetupStatusToolResponse> {
  const request = setupStatusToolRequestSchema.parse(input);

  return filterSetupDiagnosticsResponse(
    setupStatusToolResponseSchema.parse(await buildSetupDiagnosticsResponse(request.cwd)),
    request.host,
  );
}
