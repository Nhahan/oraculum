import {
  type SetupStatusActionRequest,
  type SetupStatusActionResponse,
  setupStatusActionRequestSchema,
  setupStatusActionResponseSchema,
} from "../../domain/chat-native.js";

import { buildSetupDiagnosticsResponse, filterSetupDiagnosticsResponse } from "../chat-native.js";

export async function runSetupStatusAction(
  input: SetupStatusActionRequest,
): Promise<SetupStatusActionResponse> {
  const request = setupStatusActionRequestSchema.parse(input);

  return filterSetupDiagnosticsResponse(
    setupStatusActionResponseSchema.parse(await buildSetupDiagnosticsResponse(request.cwd)),
    request.host,
  );
}
