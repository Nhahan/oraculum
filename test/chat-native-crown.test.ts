import { afterEach, describe, expect, it, vi } from "vitest";

import { createOraculumMcpServer } from "../src/services/mcp-server.js";
import { runCrownTool } from "../src/services/mcp-tools.js";
import { createCrownToolResponse } from "./helpers/chat-native.js";

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

const mockedRunCrownTool = vi.mocked(runCrownTool);

afterEach(() => {
  mockedRunCrownTool.mockReset();
});

describe("chat-native crown surface", () => {
  it("describes default crown responses as recommended-result materialization", async () => {
    const requestHandlers = (
      createOraculumMcpServer().server as unknown as {
        _requestHandlers: Map<string, unknown>;
      }
    )._requestHandlers;
    const callTool = requestHandlers.get("tools/call") as (request: {
      method: "tools/call";
      params: {
        name: "oraculum_crown";
        arguments: {
          cwd: string;
          withReport?: boolean;
        };
      };
    }) => Promise<{ content: Array<{ text: string; type: "text" }> }>;

    mockedRunCrownTool.mockResolvedValueOnce(createCrownToolResponse("cand-01"));

    const response = await callTool({
      method: "tools/call",
      params: {
        name: "oraculum_crown",
        arguments: {
          cwd: "/tmp/project",
          withReport: false,
        },
      },
    });

    expect(response.content[0]?.text).toContain(
      "The recommended result has already been materialized; do not materialize it again.",
    );
    expect(response.content[0]?.text).not.toContain(
      "The selected finalist has already been materialized",
    );
  });

  it("describes explicit crown responses as selected-finalist materialization", async () => {
    const requestHandlers = (
      createOraculumMcpServer().server as unknown as {
        _requestHandlers: Map<string, unknown>;
      }
    )._requestHandlers;
    const callTool = requestHandlers.get("tools/call") as (request: {
      method: "tools/call";
      params: {
        name: "oraculum_crown";
        arguments: {
          candidateId: string;
          cwd: string;
          withReport?: boolean;
        };
      };
    }) => Promise<{ content: Array<{ text: string; type: "text" }> }>;

    mockedRunCrownTool.mockResolvedValueOnce(createCrownToolResponse("cand-02"));

    const response = await callTool({
      method: "tools/call",
      params: {
        name: "oraculum_crown",
        arguments: {
          cwd: "/tmp/project",
          candidateId: "cand-02",
          withReport: false,
        },
      },
    });

    expect(response.content[0]?.text).toContain(
      "The selected finalist has already been materialized; do not materialize it again.",
    );
    expect(response.content[0]?.text).not.toContain(
      "The recommended result has already been materialized",
    );
  });
});
