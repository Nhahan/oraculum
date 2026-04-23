# Advanced Usage

This page is for users who want more control than the default one-command flow.

After running setup in your terminal, open Claude Code or Codex and use:

```text
orc consult "fix session loss on refresh"
```

`consult` already prints the latest summary. Everything below is for reopening a consultation later, shaping the tournament more explicitly, or using shell-only setup, uninstall, diagnostics, and MCP commands.

The primary product surface is interactive `orc ...` commands inside Claude Code and Codex after setup. The shell binary remains for setup, uninstall, diagnostics, and MCP serving only. Run `oraculum setup ...` in your terminal first. Current setup is host-level and global for your local Claude Code or Codex installation, not directory-scoped.

If you want to inspect whether the interactive `orc ...` surface is ready, run:

```bash
oraculum setup status
```

The npm package is only Oraculum's distribution channel. It does not mean the target repository must be a Node project.

Every `consult` also runs an automatic validation-posture selection step. Oraculum collects repo facts, asks the chosen runtime for a structured recommendation, validates the recommendation, and applies the resulting posture draft to that consultation only. Explicit quick-start and advanced settings still win over inferred defaults.

## Consult On A Task File

```text
orc consult tasks/fix-session-loss.md
```

`consult` accepts:

- inline task text
- a task note file
- a task packet path

## Configure Runtime And Candidate Count

Chat-native planning commands stay task-only:

```text
orc consult tasks/fix-session-loss.md
```

Available runtimes today:

- `codex`
- `claude-code`

Choose the default runtime and candidate count by editing `.oraculum/config.json`:

```json
{
  "version": 1,
  "defaultAgent": "codex",
  "defaultCandidates": 4
}
```

Both runtimes support structured validation-posture selection through their structured non-interactive output paths. That structured step is what lets Oraculum treat validation posture choice as a bounded selection problem instead of an unstructured free-form guess.

## Timeouts

The default `consult` and `plan` product path does not expose a consultation-wide adapter timeout flag. Keep bounded long-running checks at the repo-local oracle boundary with `timeoutMs` in `.oraculum/advanced.json`.

Internal validation harnesses may still apply their own process bounds. They are not part of the chat-native product input.

Shell setup and diagnostics commands still keep their explicit safety and installation flags. The task-only rule applies to `orc consult`, `orc plan`, and `orc draft`.

## Automatic Validation Posture Selection

Each consultation now writes a validation-posture selection artifact under:

```text
.oraculum/runs/<consultation-id>/reports/profile-selection.json
```

That artifact records the repo signals, the command catalog offered to the runtime, skipped command candidates, the selected validation posture, and any missing capabilities.

Today the built-in compatibility posture ids are:

- `generic`
- `library`
- `frontend`
- `migration`

The selected validation posture is consultation-scoped. It does not rewrite your saved quick-start config, and it does not overwrite explicit advanced project settings.

## Validation Posture Boundaries

The runtime does not invent executable commands. It selects from the command ids Oraculum already provided in the consultation-scoped catalog.

Unknown strategy ids and command ids are filtered out or replaced by safe fallbacks before the recommendation is applied. Unsupported validation posture ids from runtime output are normalized through deterministic fallback before they become current state. If a plausible command is not safe to generate, Oraculum records it under `skippedCommandCandidates` instead of running it. If runtime validation-posture selection fails or is disabled, fallback behavior stays conservative: zero-signal repositories use `generic`, ambiguous package managers do not silently become npm, and missing validation is recorded as `missingCapabilities`.

Repo-local scripts and explicit `.oraculum/advanced.json` oracles are strongest. Oraculum prefers repository-owned commands and configuration over built-in ecosystem-specific guesses.

## Project Roots And Task Paths

If Oraculum finds an initialized `.oraculum/config.json` in an ancestor directory, nested invocations use that initialized project root for config, runs, reports, and workspaces. If no initialized root exists, Oraculum keeps the current directory local instead of guessing a repository root.

Task paths are resolved from the invocation directory first, then from the initialized project root. Existing file-looking inputs such as `.html`, `.py`, `.go`, or `.rs` are loaded as task notes. Missing file-looking inputs fail fast instead of being treated as inline prose. Plain inline text is materialized under `.oraculum/tasks/`.

## Inspect A Specific Consultation

```text
orc verdict run_20260404_xxxx
```

Without a consultation id, `verdict` uses the latest consultation automatically.

## Browse Recent Consultations

```text
orc verdict archive
orc verdict archive 20
```

Use this when you want to reopen an older consultation without remembering the exact id first.

## Crown The Recommended Result

```text
orc crown fix/session-loss
```

The shared `crown` path crowns the latest recommended result automatically.

In a Git-backed project, `crown` expects the target branch name as the first argument, creates that branch, and materializes the recommended result there. In a non-Git project, use bare `orc crown`; it syncs the crowned workspace back into the project folder. If you pass a first argument in workspace-sync mode, Oraculum records it only as a materialization label.

When available, the crowning record points at artifacts such as:

- finalist-to-finalist comparison summaries
- Markdown comparison reports
- recommended result records
- change summaries, witness rollups, and why-this-won rationale

By default, `crown` refuses to materialize a result when validation gaps remain, the recommendation came from fallback policy, or a second-opinion judge disagreed or was unavailable. Use `orc crown --allow-unsafe` only after manual operator review; the export plan records `safetyOverride: "operator-allow-unsafe"`.

## Research Briefs And Failure Analysis

When preflight decides that repo-only evidence is insufficient, Oraculum writes a bounded research artifact under:

```text
.oraculum/runs/<consultation-id>/reports/research-brief.json
```

That artifact carries the research question, summary, sources, claims, version notes, unresolved conflicts, and conflict handling. You can reuse it directly as the next task input:

```text
orc consult .oraculum/runs/<consultation-id>/reports/research-brief.json
```

If bounded repair or finalist judgment fails to converge, Oraculum may also write:

```text
.oraculum/runs/<consultation-id>/reports/failure-analysis.json
```

That artifact is for investigation, not auto-retry. It summarizes why execution stalled, which candidates failed repeatedly, and what evidence should be inspected before rerunning or manually crowning.

## Repeated Clarify Follow-Up

When the same scope repeatedly lands in `needs-clarification` or `external-research-required`, Oraculum can persist a bounded follow-up artifact under:

```text
.oraculum/runs/<consultation-id>/reports/clarify-follow-up.json
```

That artifact does not replace the blocked preflight decision. It records:

- one key clarify question
- one missing result contract statement
- one missing judging basis statement

`orc verdict` and saved consultation summaries replay that artifact into rerun guidance so the operator can answer the bounded question before reopening the consultation.

## Saved Verdict Artifacts

`orc verdict` stays read-only, but the saved consultation directory can include richer artifacts than the default summary prints.

Common examples include:

- comparison reports
- winner-selection records
- research briefs
- failure-analysis summaries

Use these when you want to inspect why a consultation stopped, why a winner was recommended, or what to rerun next.

## Explicit Init

```text
orc init
```

You usually do not need this because `consult` auto-initializes the project on first use.
If you run `orc init --force`, Oraculum resets the quick-start config and removes any existing `.oraculum/advanced.json`.

## Plan First

```text
orc plan tasks/fix-session-loss.md
```

Use this when the task is broad, risky, or still needs a stronger execution contract before candidate generation. Oraculum persists:

- `.oraculum/runs/<consultation-id>/reports/planning-depth.json`
- `.oraculum/runs/<consultation-id>/reports/planning-interview.json` when clarification is needed
- `.oraculum/runs/<consultation-id>/reports/planning-spec.json` when the interview/spec gate is ready
- `.oraculum/runs/<consultation-id>/reports/plan-consensus.json` when consensus review completes
- `.oraculum/runs/<consultation-id>/reports/consultation-plan.json`
- `.oraculum/runs/<consultation-id>/reports/plan-readiness.json`
- `.oraculum/runs/<consultation-id>/reports/consultation-plan.md`

If the requested plan lacks a concrete result contract or judging basis, `orc plan` stops before candidate planning and asks one clarification question. Answer it with another `orc plan` call. Oraculum asks the runtime to classify whether the new input is a continuation of the active interview rather than relying on a hardcoded answer prefix:

```text
orc plan "Email/password login only, protect /dashboard, no OAuth."
```

The JSON artifact is rerunnable:

```text
orc consult .oraculum/runs/<consultation-id>/reports/consultation-plan.json
```

Explicit planning uses model judgment for planning depth, interview questions, readiness scoring, planning-spec crystallization, architect review, critic review, and bounded revision. Deterministic code only validates schemas, writes artifacts, checks path safety through the plan schema, and enforces runaway caps.

The default safety caps live in the advanced project layer:

```json
{
  "version": 1,
  "planning": {
    "explicitPlanMaxInterviewRounds": 8,
    "explicitPlanMaxConsensusRevisions": 3,
    "explicitPlanModelCallTimeoutMs": 120000,
    "consultLiteMaxPlanningCalls": 1
  }
}
```

These caps are operator safety boundaries, not semantic heuristics. `orc consult` stays on the lighter path: it can block on one high-value clarification, but it does not run the full multi-round interview and consensus pipeline unless you explicitly use `orc plan` or `orc draft`.

`orc consult <consultation-plan.json>` checks `plan-readiness.json` before creating candidates. If the plan still lacks information, Oraculum asks for clarification instead of treating that as an execution block. It fails fast only for hard readiness problems such as invalid artifacts, stale plan basis, or planned oracle ids that no longer exist in the execution contract.

Plan review findings, when present, are advisory unless deterministic readiness finds a hard execution blocker. `orc verdict` shows review and readiness artifacts that were produced by the planning lane.

`orc draft ...` remains available as a compatibility alias for the same planning lane.

## Shell Setup And MCP Commands

Use the shell binary for installation, uninstall, diagnostics, and MCP serving only.

### Setup Host Integration

```bash
oraculum setup --runtime claude-code
oraculum setup --runtime codex
```

Run setup in your terminal, not inside the Claude Code or Codex chat input. This registers Oraculum globally for your local host installation.

Stable/default usage is the interactive `orc ...` path inside the host, for example:

```text
orc consult "안녕"
```

### Check Setup Status

```bash
oraculum setup status
oraculum setup status --json
```

Use the plain command for a readable summary, or `--json` when you want machine-readable diagnostics.

### Host Policies

Oraculum keeps the `orc ...` language shared across Claude Code and Codex. The stable/default workflow for both hosts is the interactive `orc ...` path inside the host session.

| Host | Interactive `orc ...` | Product status |
| --- | --- | --- |
| Claude Code | supported | stable default |
| Codex | supported | stable default |

Interpretation:

- Oraculum installs the host-specific plugin, skills, rules, and MCP wiring needed for `orc ...`.
- Under the hood, Oraculum still uses the host's official lower-level transport where available.

Use `oraculum setup status --json` when you want the current host setup state as machine-readable diagnostics.

### Uninstall Host Integration

Use `oraculum uninstall` to remove Oraculum's global Claude Code and Codex host wiring.

```bash
oraculum uninstall
oraculum uninstall --runtime claude-code
oraculum uninstall --runtime codex
```

This removes host registration and installed host artifacts. If you also want to remove the globally installed npm package itself, run `npm uninstall -g oraculum` separately.

### Run The MCP Server Directly

```bash
oraculum mcp serve
```

Use this only if you are integrating Oraculum with another MCP-capable client. Normal Claude Code and Codex usage should go through `orc ...` after setup.

## Repo-Local Oracles

Put repo-specific command checks in `.oraculum/advanced.json`.

Example:

```json
{
  "version": 1,
  "oracles": [
    {
      "id": "lint-fast",
      "roundId": "fast",
      "command": "npm",
      "args": ["run", "lint"],
      "cwd": "workspace",
      "relativeCwd": "packages/app",
      "pathPolicy": "inherit",
      "invariant": "The candidate must satisfy lint checks.",
      "enforcement": "hard",
      "timeoutMs": 300000
    }
  ]
}
```

Use `command` with `args` when you want an exact executable invocation. Use a shell-style command string only when that is the behavior you want.
`cwd` can be `workspace` or `project`; add `relativeCwd` when a monorepo or polyglot check must run below that scope. `relativeCwd` must stay inside the selected scope, so absolute paths and `..` traversal are rejected.
`pathPolicy` defaults to `local-only`, which exposes only discovered candidate/project local tool paths; an explicit oracle `env.PATH` overrides that computed value. Use `pathPolicy: "inherit"` only when the oracle intentionally needs the host global `PATH`, for example an operator-owned package-manager command.
`timeoutMs` is optional and applies only to that oracle command. Use it when the repository wants a bounded long-running check; leaving it out does not inherit a product-wide adapter timeout.

Supported enforcement levels:

- `hard`: fail the candidate immediately
- `repairable`: record a failure that can trigger a bounded repair attempt in the same round; unresolved repairable findings still block crowning
- `signal`: keep the candidate alive, but record the warning

You can also tune bounded repair behavior in `.oraculum/advanced.json`:

```json
{
  "version": 1,
  "repair": {
    "enabled": true,
    "maxAttemptsPerRound": 1
  }
}
```

## Managed Tree Rules

Copy-mode workspaces and non-Git crowning ignore dependency, cache, runtime-state, and sensitive paths by default. Copy-mode workspaces may link unmanaged local dependency/cache trees such as `node_modules`, `.venv`, `venv`, `.tox`, `target`, or `.gradle` instead of copying them. This preserves existing local tool behavior without treating those names as validation commands.

Local state directories such as `.idea`, `.terraform`, `.serverless`, and `.pulumi` are unmanaged by default because they are commonly machine-local or generated. Source-like settings that are often intentionally checked in, such as `.vscode` and `.devcontainer`, are not excluded by default.

Sensitive paths stay protected even if an include rule is present. Examples include `.env*`, `.aws`, `.ssh`, `.kube`, `.npmrc`, `.docker/config.json`, `.azure/accessTokens.json`, and gcloud credential files under `.config/gcloud`.

Managed files are processed as bytes. Snapshots hash file content through streams, and workspace-sync copies files without text decoding, so large or binary source artifacts stay valid without being loaded as UTF-8 text.

Some names are ambiguous across ecosystems: `dist` or `target` may be generated output in one repository and intentional source or published artifacts in another.

Use `managedTree` only when the repository really intends to include or exclude such paths:

```json
{
  "version": 1,
  "managedTree": {
    "includePaths": ["dist", "target/docs"],
    "excludePaths": ["build"]
  }
}
```

Paths must be safe relative paths inside the project root. `includePaths` can opt ambiguous generated or local-state directories back into workspace copy, snapshots, change detection, and non-Git crowning. Included paths are managed, so they are not dependency-tree linked. `includePaths` does not override protected paths such as `.git`, `.oraculum`, `.env*`, or credential paths.

## Where Advanced Settings Belong

Quick start should stay simple.

Use `.oraculum/config.json` for quick-start defaults such as:

- `defaultAgent`
- `defaultCandidates`

Use `.oraculum/advanced.json` for advanced project settings such as:

- repo-local oracles
- repair policy
- managed tree include/exclude rules for ambiguous generated paths
- custom rounds and strategy portfolios
- future profile-level overrides

Use advanced settings only for things like:

- choosing a specific runtime
- changing candidate count
- adding repo-local oracle commands in `.oraculum/advanced.json`
- tuning repair, judge, strategy, round, and managed-tree policy

If a workflow can be expressed without these controls, prefer the simple path.
