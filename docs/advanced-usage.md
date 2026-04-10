# Advanced Usage

This page is for users who want more control than the default one-command flow.

Host-native path after setup in Claude Code or Codex:

```text
orc consult "fix session loss on refresh"
orc crown fix/session-loss
```

`consult` already prints the latest summary. Everything below is for reopening a consultation later, shaping the tournament more explicitly, or using shell-only setup and MCP commands.

The primary product surface is a host-native chat surface with a shared `orc` command language across Claude Code and Codex. The shell binary remains for setup, MCP serving, and debugging. It no longer exposes the workflow commands directly.

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
- a Markdown task note
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

That artifact records:

- detected repo signals
- capability signals and signal provenance
- the command catalog offered to the runtime
- skipped command candidates and reasons
- the chosen profile id
- confidence and rationale
- missing capabilities
- the consultation-scoped strategy and oracle defaults that were applied

Today the built-in profile families are:

- `generic`
- `library`
- `frontend`
- `migration`

The selected profile is consultation-scoped. It does not rewrite your saved quick-start config, and it does not overwrite explicit advanced operator settings.

## Profile Boundary And Runtime Failures

Oraculum assumes Claude Code or Codex is a frontier coding model. Deterministic code owns facts and safety: file signals, manifests, workspace roots, explicit config, command allowlists, timeouts, and artifact persistence. The model owns semantic judgment: profile choice, risk level, validation sufficiency, and which provided commands to select.

The model cannot invent executable commands for Oraculum to run. It returns command ids from the catalog Oraculum provided, and Oraculum rejects unknown profile ids, strategy ids, and command ids. Catalog commands include source, capability, dedupe key, path policy, safety, and provenance metadata. If a plausible command is not safe to generate, Oraculum records it under `skippedCommandCandidates` with a reason instead of running it. If runtime profile selection fails or is disabled, runtime-unavailable detection is conservative: zero-signal repositories use `generic`, ambiguous package managers do not silently become npm, and missing validation is recorded as `missingCapabilities`.

Repo-local scripts and explicit `.oraculum/advanced.json` oracles are strongest. Oraculum should not grow a built-in encyclopedia of framework, ORM, migration-tool, test-runner, or language-specific command recipes. Named tools, including Prisma or Drizzle, are recorded as evidence unless a repo-local script or explicit oracle defines the command.

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

The shared host-native `crown` path expects the target branch name or materialization label as the first argument and crowns the latest recommended survivor automatically.

In a Git-backed project, `crown` creates the target branch and applies the recommended survivor there. In a non-Git project, it syncs the crowned workspace back into the project folder.

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

Use the shell binary for installation, diagnostics, and MCP serving only.

```bash
oraculum setup --runtime claude-code
oraculum setup --runtime codex
oraculum setup status
oraculum setup status --json
oraculum mcp serve
```

## Maintainer Validation

For packaged validation during release work, run:

```bash
npm run evidence:smoke
```

This executes the installed-package smoke and the clean-install setup smoke together.

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

## Where Advanced Settings Belong

Quick start should stay simple.

Use `.oraculum/config.json` for quick-start defaults such as:

- `defaultAgent`
- `defaultCandidates`

Use `.oraculum/advanced.json` for operator controls such as:

- repo-local oracles
- repair policy
- custom rounds and strategy portfolios
- future profile- or policy-level overrides

Use advanced settings only for things like:

- choosing a specific runtime
- changing candidate count
- adding repo-local oracle commands in `.oraculum/advanced.json`
- selecting a specific consultation for verdict inspection

If a workflow can be expressed without these controls, prefer the simple path.
