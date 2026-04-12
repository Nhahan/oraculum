# Advanced Usage

This page is for users who want more control than the default one-command flow.

After running setup in your terminal, the host-native path in Claude Code or Codex is:

```text
orc consult "fix session loss on refresh"
orc crown fix/session-loss
```

`consult` already prints the latest summary. Everything below is for reopening a consultation later, shaping the tournament more explicitly, or using shell-only setup, uninstall, and MCP commands.

The primary product surface is a host-native chat surface with a shared `orc` command language across Claude Code and Codex. The shell binary remains for setup, uninstall, diagnostics, and MCP serving only. Run `oraculum setup ...` in your terminal, then use `orc ...` inside the host chat input. Current setup is host-level and global for your local Claude Code or Codex installation, not directory-scoped.

If you want to inspect whether host-native wiring is complete, run:

```bash
oraculum setup status
```

The npm package is only Oraculum's distribution channel. It does not mean the target repository must be a Node project.

Every `consult` also runs an automatic profile-selection step. Oraculum collects repo facts, asks the chosen runtime for a structured recommendation, validates the recommendation, and applies the resulting profile draft to that consultation only. Explicit quick-start and advanced settings still win over inferred defaults.

## Consult On A Task File

```text
orc consult tasks/fix-session-loss.md
```

`consult` accepts:

- inline task text
- a task note file
- a task packet path

## Choose Runtime And Candidate Count

```text
orc consult tasks/fix-session-loss.md --agent codex --candidates 4
```

Available runtimes today:

- `codex`
- `claude-code`

Both runtimes support structured profile selection:

- `codex` via `exec --output-schema`
- `claude-code` via `-p --output-format json --json-schema`

That structured step is what lets Oraculum treat profile choice as a bounded selection problem instead of an unstructured free-form guess.

## Automatic Profile Selection

Each consultation now writes a profile-selection artifact under:

```text
.oraculum/runs/<consultation-id>/reports/profile-selection.json
```

That artifact records the repo signals, the command catalog offered to the runtime, skipped command candidates, the chosen profile, and any missing capabilities.

Today the built-in profile families are:

- `generic`
- `library`
- `frontend`
- `migration`

The selected profile is consultation-scoped. It does not rewrite your saved quick-start config, and it does not overwrite explicit advanced operator settings.

## Profile Selection Boundaries

The runtime does not invent executable commands. It selects from the command ids Oraculum already provided in the consultation-scoped catalog.

Invalid profile ids fail schema validation. Unknown strategy ids and command ids are filtered out or replaced by safe fallbacks before the recommendation is applied. If a plausible command is not safe to generate, Oraculum records it under `skippedCommandCandidates` instead of running it. If runtime profile selection fails or is disabled, fallback behavior stays conservative: zero-signal repositories use `generic`, ambiguous package managers do not silently become npm, and missing validation is recorded as `missingCapabilities`.

Repo-local scripts and explicit `.oraculum/advanced.json` oracles are strongest. Oraculum should not grow a built-in encyclopedia of framework, ORM, migration-tool, test-runner, or language-specific command recipes. Named tools, including Prisma or Drizzle, are recorded as evidence unless a repo-local script or explicit oracle defines the command.

For the stable product-policy version of this boundary, see [Frontier Boundary Policy](./frontier-boundary-policy.md).

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

## Crown The Recommended Survivor

```text
orc crown fix/session-loss
```

The shared host-native `crown` path crowns the latest recommended survivor automatically.

In a Git-backed project, `crown` expects the target branch name as the first argument, creates that branch, and applies the recommended survivor there. In a non-Git project, use bare `orc crown`; it syncs the crowned workspace back into the project folder. If you pass a first argument in workspace-sync mode, Oraculum records it only as a materialization label.

When available, the crowning record points at artifacts such as:

- finalist-to-finalist comparison summaries
- Markdown comparison reports
- recommended survivor records
- change summaries, witness rollups, and why-this-won rationale

This keeps the default path short while leaving richer review material in the advanced path.

## Explicit Init

```text
orc init
```

You usually do not need this because `consult` auto-initializes the project on first use.
If you run `orc init --force`, Oraculum resets the quick-start config and removes any existing `.oraculum/advanced.json`.

## Plan Only

```text
orc draft tasks/fix-session-loss.md
```

This is mainly for development or internal inspection. It scaffolds the consultation without executing candidates.

## Shell Setup And MCP Commands

Use the shell binary for installation, uninstall, diagnostics, and MCP serving only.

### Setup Host Integration

```bash
oraculum setup --runtime claude-code
oraculum setup --runtime codex
```

Run setup in your terminal, not inside the Claude Code or Codex chat input. This registers Oraculum globally for your local host installation.

### Check Setup Status

```bash
oraculum setup status
oraculum setup status --json
```

Use the plain command for a readable summary, or `--json` when you want machine-readable diagnostics.

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

This is mainly for internal debugging or direct MCP integration checks. Normal Claude Code and Codex usage should go through `orc ...` after setup.

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
      "enforcement": "hard"
    }
  ]
}
```

Use `command` with `args` when you want an exact executable invocation. Use a shell-style command string only when that is the behavior you want.
`cwd` can be `workspace` or `project`; add `relativeCwd` when a monorepo or polyglot check must run below that scope. `relativeCwd` must stay inside the selected scope, so absolute paths and `..` traversal are rejected.
`pathPolicy` defaults to `local-only`, which exposes only discovered candidate/project local tool paths; an explicit oracle `env.PATH` overrides that computed value. Use `pathPolicy: "inherit"` only when the oracle intentionally needs the host global `PATH`, for example an operator-owned package-manager command.

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

Use `.oraculum/advanced.json` for operator controls such as:

- repo-local oracles
- repair policy
- managed tree include/exclude rules for ambiguous generated paths
- custom rounds and strategy portfolios
- future profile- or policy-level overrides

Use advanced settings only for things like:

- choosing a specific runtime
- changing candidate count
- adding repo-local oracle commands in `.oraculum/advanced.json`
- selecting a specific consultation for verdict inspection

If a workflow can be expressed without these controls, prefer the simple path.
