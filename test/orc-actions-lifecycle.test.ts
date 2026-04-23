import { describe, expect, it, vi } from "vitest";

vi.mock("../src/core/subprocess.js", () => ({
  runSubprocess: vi.fn(),
}));

vi.mock("../src/services/runs.js", () => ({
  planRun: vi.fn(),
  readLatestRunManifest: vi.fn(),
  readRunManifest: vi.fn(),
  writeLatestRunState: vi.fn(),
}));

vi.mock("../src/services/execution.js", () => ({
  executeRun: vi.fn(),
}));

vi.mock("../src/services/project.js", async () => {
  const actual = await vi.importActual<typeof import("../src/services/project.js")>(
    "../src/services/project.js",
  );

  return {
    ...actual,
    ensureProjectInitialized: vi.fn(),
    hasNonEmptyTextArtifact: vi.fn(() => false),
    hasNonEmptyTextArtifactSync: vi.fn(() => false),
    initializeProject: vi.fn(),
  };
});

vi.mock("../src/services/consultations.js", () => ({
  buildVerdictReview: vi.fn(),
  renderConsultationSummary: vi.fn(),
}));

vi.mock("../src/services/exports.js", () => ({
  materializeExport: vi.fn(),
}));

import { summarizeSetupDiagnosticsHosts } from "../src/services/chat-native.js";
import { runSetupStatusAction } from "../src/services/orc-actions.js";
import { registerOrcActionsTestHarness } from "./helpers/orc-actions.js";

registerOrcActionsTestHarness();

describe("chat-native Orc actions: lifecycle", () => {
  it("rejects unknown setup-status request fields", async () => {
    await expect(
      runSetupStatusAction({
        cwd: "/tmp/project",
        host: "codex",
        json: true,
      } as Parameters<typeof runSetupStatusAction>[0]),
    ).rejects.toThrow(/Unrecognized key/);
  });

  it("filters setup-status responses to the requested host", async () => {
    const response = await runSetupStatusAction({
      cwd: process.cwd(),
      host: "codex",
    });

    expect(response.hosts).toHaveLength(1);
    expect(response.hosts[0]?.host).toBe("codex");
    expect(response.summary).toBe(
      summarizeSetupDiagnosticsHosts(
        response.hosts.map((host) => ({
          host: host.host,
          status: host.status,
          registered: host.registered,
          artifactsInstalled: host.artifactsInstalled,
          launchTransport: host.launchTransport,
        })),
      ),
    );
  });
});
