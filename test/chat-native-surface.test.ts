import { constants } from "node:fs";
import { access } from "node:fs/promises";
import { join } from "node:path";

import { describe, expect, it } from "vitest";
import {
  crownMaterializationSchema,
  crownToolRequestSchema,
  mcpToolIdSchema,
} from "../src/domain/chat-native.js";
import {
  getMcpToolSchemas,
  oraculumCommandManifest,
  oraculumMcpToolSurface,
} from "../src/services/chat-native.js";
import { createOraculumMcpServer } from "../src/services/mcp-server.js";

describe("chat-native surface", () => {
  it("defines schemas for every declared MCP tool", () => {
    const declaredToolIds = oraculumMcpToolSurface.map((tool) => tool.id);

    expect(new Set(declaredToolIds)).toHaveLength(declaredToolIds.length);
    expect(new Set(declaredToolIds)).toEqual(new Set(mcpToolIdSchema.options));

    for (const tool of oraculumMcpToolSurface) {
      const schemas = getMcpToolSchemas(tool.id);
      expect(schemas.request).toBeDefined();
      expect(schemas.response).toBeDefined();
    }
  });

  it("describes crown tooling in artifact-neutral terms", () => {
    const crownTool = oraculumMcpToolSurface.find((tool) => tool.id === "oraculum_crown");
    const crownCommand = oraculumCommandManifest.find((entry) => entry.id === "crown");

    expect(crownTool?.purpose).toContain("recommended result");
    expect(crownTool?.purpose).toContain("explicitly selected finalist");
    expect(crownTool?.requestShape).toBe("crownToolRequestInputSchema");
    expect(crownCommand?.summary).toBe(
      "Crown the recommended result and materialize it in the project.",
    );
    expect(crownCommand?.requestShape).toBe("crownToolRequestInputSchema");
  });

  it("publishes crown input schema without requiring branchName, materializationName, or materializationLabel", async () => {
    const requestHandlers = (
      createOraculumMcpServer().server as unknown as {
        _requestHandlers: Map<string, unknown>;
      }
    )._requestHandlers;
    const listTools = requestHandlers.get("tools/list") as (request: {
      method: "tools/list";
      params: Record<string, never>;
    }) => Promise<{ tools: Array<{ inputSchema: Record<string, unknown>; name: string }> }>;

    const response = await listTools({
      method: "tools/list",
      params: {},
    });
    const crown = response.tools.find((tool) => tool.name === "oraculum_crown");

    expect(crown).toBeDefined();
    expect(crown?.inputSchema).toMatchObject({
      properties: {
        branchName: {
          minLength: 1,
          type: "string",
        },
        materializationName: {
          minLength: 1,
          type: "string",
        },
        materializationLabel: {
          minLength: 1,
          type: "string",
        },
      },
      required: ["cwd"],
      type: "object",
    });
  });

  it("accepts crown materialization aliases in both request and response schemas", () => {
    const request = crownToolRequestSchema.parse({
      cwd: "/tmp/project",
      materializationName: "fix/session-loss",
      withReport: true,
    });
    const materialization = crownMaterializationSchema.parse({
      materialized: true,
      verified: true,
      materializationMode: "branch",
      materializationName: "fix/session-loss",
      currentBranch: "fix/session-loss",
      changedPaths: ["src/message.js"],
      changedPathCount: 1,
      checks: [
        {
          id: "current-branch",
          status: "passed",
          summary: "Current git branch is fix/session-loss.",
        },
      ],
    });

    expect(request.branchName).toBe("fix/session-loss");
    expect(request.materializationName).toBe("fix/session-loss");
    expect(materialization.mode).toBe("git-branch");
    expect(materialization.materializationMode).toBe("branch");
    expect(materialization.branchName).toBe("fix/session-loss");
    expect(materialization.materializationName).toBe("fix/session-loss");
  });

  it("keeps one shared command vocabulary on the orc prefix", () => {
    expect(oraculumCommandManifest.map((entry) => entry.path.join(" "))).toEqual([
      "consult",
      "verdict",
      "verdict archive",
      "crown",
      "plan",
      "draft",
      "init",
    ]);

    for (const entry of oraculumCommandManifest) {
      expect(entry.prefix).toBe("orc");
      expect(oraculumMcpToolSurface.some((tool) => tool.id === entry.mcpTool)).toBe(true);
    }
  });

  it("describes consultation candidate counts in artifact-neutral terms", () => {
    const consultCommand = oraculumCommandManifest.find((entry) => entry.id === "consult");
    const planCommand = oraculumCommandManifest.find((entry) => entry.id === "plan");
    const draftCommand = oraculumCommandManifest.find((entry) => entry.id === "draft");
    const crownCommand = oraculumCommandManifest.find((entry) => entry.id === "crown");

    expect(
      consultCommand?.arguments.find((argument) => argument.name === "candidates")?.description,
    ).toBe("Number of candidate variants to plan.");
    expect(
      planCommand?.arguments.find((argument) => argument.name === "candidates")?.description,
    ).toBe("Number of candidate variants to plan.");
    expect(
      draftCommand?.arguments.find((argument) => argument.name === "candidates")?.description,
    ).toBe("Number of candidate variants to plan.");
    expect(crownCommand?.arguments[0]).toMatchObject({
      name: "materializationName",
      description:
        "Branch name to create, or an optional workspace-sync materialization label in non-Git projects.",
    });
  });

  it("binds every MCP tool to real repo modules plus at most a thin adapter layer", async () => {
    for (const tool of oraculumMcpToolSurface) {
      for (const binding of tool.bindings) {
        await expect(access(join(process.cwd(), binding.module), constants.F_OK)).resolves.toBe(
          undefined,
        );
      }
    }
  });
});
