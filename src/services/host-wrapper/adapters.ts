import type { Adapter } from "../../domain/config.js";
import type {
  HostWrapperAdapter,
  HostWrapperFilterState,
  HostWrapperLineDecision,
} from "./types.js";

const ORC_PROGRESS_PATTERNS = [
  "Working",
  "Calling",
  "Starting consultation",
  "Planning consultation",
  "Candidate ",
  "Verdict ready",
];

const CLAUDE_PROGRESS_PATTERNS = [
  "thinking",
  "bypass permissions on",
  "Starting consultation",
  "Planning consultation",
  "Candidate ",
  "Verdict ready",
];

function keepLine(): HostWrapperLineDecision {
  return { keep: true };
}

function suppressLine(): HostWrapperLineDecision {
  return { keep: false };
}

function matchesAny(line: string, patterns: readonly string[]): boolean {
  return patterns.some((pattern) => line.includes(pattern));
}

function matchesCodexNoiseLine(line: string): boolean {
  if (line === "• Explored") {
    return true;
  }

  if (line.startsWith("└ Read ")) {
    return true;
  }

  if (!line.startsWith("• ")) {
    return false;
  }

  return !matchesAny(line, ORC_PROGRESS_PATTERNS);
}

function buildCodexWrapperAdapter(): HostWrapperAdapter {
  return {
    host: "codex",
    hostBinary: "codex",
    directPassThroughFlags: new Set([
      "--help",
      "-h",
      "--version",
      "-V",
      "--remote",
      "--remote-auth-token-env",
    ]),
    directPassThroughSubcommands: new Set([
      "app",
      "app-server",
      "apply",
      "cloud",
      "completion",
      "debug",
      "exec",
      "exec-server",
      "features",
      "fork",
      "help",
      "login",
      "logout",
      "marketplace",
      "resume",
      "review",
      "sandbox",
    ]),
    shouldSuppressLine(line: string, state: HostWrapperFilterState): HostWrapperLineDecision {
      if (!state.pendingOrcCommand) {
        return keepLine();
      }

      if (matchesAny(line, ORC_PROGRESS_PATTERNS)) {
        state.pendingOrcCommand = false;
        state.suppressTreeDetail = false;
        return keepLine();
      }

      if (line === "• Explored") {
        state.suppressTreeDetail = true;
        return suppressLine();
      }

      if (state.suppressTreeDetail && line.startsWith("└ ")) {
        state.suppressTreeDetail = false;
        return suppressLine();
      }

      if (matchesCodexNoiseLine(line)) {
        return suppressLine();
      }

      return keepLine();
    },
  };
}

function buildClaudeWrapperAdapter(): HostWrapperAdapter {
  return {
    host: "claude-code",
    hostBinary: "claude",
    directPassThroughFlags: new Set(["--help", "-h", "--version", "-v", "--print", "-p"]),
    directPassThroughSubcommands: new Set([
      "agents",
      "auth",
      "auto-mode",
      "doctor",
      "install",
      "plugin",
      "plugins",
      "setup-token",
      "update",
      "upgrade",
    ]),
    shouldSuppressLine(line: string, state: HostWrapperFilterState): HostWrapperLineDecision {
      if (!state.pendingOrcCommand) {
        return keepLine();
      }

      if (/skill|plugin/iu.test(line) || line.includes("Skill(orc:")) {
        return suppressLine();
      }

      if (matchesAny(line, CLAUDE_PROGRESS_PATTERNS)) {
        state.pendingOrcCommand = false;
        state.suppressTreeDetail = false;
        return keepLine();
      }

      return keepLine();
    },
  };
}

export function getHostWrapperAdapter(host: Adapter): HostWrapperAdapter {
  if (host === "codex") {
    return buildCodexWrapperAdapter();
  }

  if (host === "claude-code") {
    return buildClaudeWrapperAdapter();
  }

  throw new Error(`Unsupported host wrapper runtime: ${host satisfies never}`);
}
