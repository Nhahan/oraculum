import { afterEach, describe, expect, it, vi } from "vitest";

import { consultToolResponseSchema } from "../src/domain/chat-native.js";
import { buildSavedConsultationStatus } from "../src/domain/run.js";
import type { ConsultProgressEvent } from "../src/services/consult-progress.js";
import { createOraculumMcpServer } from "../src/services/mcp-server.js";
import { runConsultTool } from "../src/services/mcp-tools.js";
import { createCompletedManifest } from "./helpers/mcp-tools.js";

vi.mock("../src/services/mcp-tools.js", () => ({
  runConsultTool: vi.fn(),
  runPlanTool: vi.fn(),
  runCrownTool: vi.fn(),
  runDraftTool: vi.fn(),
  runInitTool: vi.fn(),
  runSetupStatusTool: vi.fn(),
  runVerdictArchiveTool: vi.fn(),
  runVerdictTool: vi.fn(),
}));

const mockedRunConsultTool = vi.mocked(runConsultTool);

function createConsultToolResponse() {
  const consultation = createCompletedManifest();
  return consultToolResponseSchema.parse({
    mode: "consult",
    consultation,
    status: buildSavedConsultationStatus(consultation),
    summary: "Consultation summary.\n",
    artifacts: {
      consultationRoot: "/tmp/project/.oraculum/runs/run_1",
    },
  });
}

afterEach(() => {
  mockedRunConsultTool.mockReset();
});

describe("chat-native consult progress surface", () => {
  it("forwards consult progress as MCP notifications", async () => {
    mockedRunConsultTool.mockImplementationOnce(async (_request, options) => {
      await options?.onProgress?.({
        kind: "candidate-running",
        phase: "execution",
        candidateId: "cand-01",
        candidateIndex: 1,
        candidateCount: 1,
        message: "Candidate 1/1 (cand-01) running",
      });
      await options?.onProgress?.({
        kind: "comparing-finalists",
        phase: "judging",
        finalistCount: 1,
        message: "Comparing 1 surviving candidate",
      });
      return createConsultToolResponse();
    });

    const sendNotification = vi.fn().mockResolvedValue(undefined);
    const requestHandlers = (
      createOraculumMcpServer().server as unknown as {
        _requestHandlers: Map<string, unknown>;
      }
    )._requestHandlers;
    const callTool = requestHandlers.get("tools/call") as (
      request: {
        method: "tools/call";
        params: {
          name: "oraculum_consult";
          arguments: {
            cwd: string;
            taskInput: string;
          };
        };
      },
      extra: {
        _meta: { progressToken: string };
        sendNotification: typeof sendNotification;
        signal: AbortSignal;
      },
    ) => Promise<{ content: Array<{ text: string; type: "text" }> }>;

    const response = await callTool(
      {
        method: "tools/call",
        params: {
          name: "oraculum_consult",
          arguments: {
            cwd: "/tmp/project",
            taskInput: "tasks/task.md",
          },
        },
      },
      {
        _meta: { progressToken: "progress-token" },
        sendNotification,
        signal: new AbortController().signal,
      },
    );

    expect(sendNotification).toHaveBeenNthCalledWith(1, {
      method: "notifications/progress",
      params: {
        progressToken: "progress-token",
        progress: 1,
        message: "Candidate 1/1 (cand-01) running",
        _meta: {
          kind: "candidate-running",
          phase: "execution",
          event: {
            kind: "candidate-running",
            phase: "execution",
            candidateId: "cand-01",
            candidateIndex: 1,
            candidateCount: 1,
            message: "Candidate 1/1 (cand-01) running",
          } satisfies ConsultProgressEvent,
        },
      },
    });
    expect(sendNotification).toHaveBeenNthCalledWith(2, {
      method: "notifications/progress",
      params: {
        progressToken: "progress-token",
        progress: 2,
        message: "Comparing 1 surviving candidate",
        _meta: {
          kind: "comparing-finalists",
          phase: "judging",
          event: {
            kind: "comparing-finalists",
            phase: "judging",
            finalistCount: 1,
            message: "Comparing 1 surviving candidate",
          } satisfies ConsultProgressEvent,
        },
      },
    });
    expect(response.content[0]?.text).toBe("Consultation summary.\n");
  });
});
