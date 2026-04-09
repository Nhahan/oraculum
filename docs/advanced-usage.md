# Advanced Usage

This page is for users who want more control than the default one-command flow.

Host-native path after setup in Claude Code or Codex:

```text
orc consult "fix session loss on refresh"
orc crown fix/session-loss
```

Secondary shell fallback:

```bash
oraculum consult "fix session loss on refresh"
oraculum crown --branch fix/session-loss
```

`consult` already prints the latest summary. Everything below is for reopening a consultation later, overriding the default recommendation, or shaping the tournament more explicitly.

The primary product surface is a host-native chat surface with a shared `orc` command language across Claude Code and Codex. The shell CLI remains a secondary compatibility/debug path.

Every `consult` also runs an automatic profile-selection step. Oraculum scans repo signals, asks the chosen runtime for a structured recommendation, and applies the resulting profile draft to that consultation only. Explicit quick-start and advanced settings still win over inferred defaults.

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
- the chosen profile id
- confidence and rationale
- missing capabilities
- the consultation-scoped strategy and oracle defaults that were applied

Today the built-in profile families are:

- `library`
- `frontend`
- `migration`

The selected profile is consultation-scoped. It does not rewrite your saved quick-start config, and it does not overwrite explicit advanced operator settings.

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

## Crown From A Specific Consultation

```text
orc crown fix/session-loss
```

The current host-native `crown` path expects the branch name as the first argument and crowns the latest recommended survivor automatically. The shell fallback still supports the fuller `--consultation`, `--branch`, `--with-report`, and explicit candidate form while the chat-native parser stays narrow.

## Manually Override The Recommended Winner

Choosing a candidate id yourself is the advanced path. Use the shell fallback when you need explicit candidate or consultation selection. The default host-native path is to let Oraculum recommend a survivor and materialize that choice.

## Report Bundle

Use `--with-report` when you want the crowning record to carry report metadata for later review.

```bash
oraculum crown --branch fix/session-loss --with-report
```

In a Git-backed project, `crown` creates the target branch and applies the recommended survivor there. In a non-Git project, it syncs the crowned workspace back into the project folder.

When available, the report bundle points at artifacts such as:

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

Current temporary shell fallback:

```bash
oraculum consult tasks/fix-session-loss.md
oraculum verdict run_20260404_xxxx
oraculum crown --consultation run_20260404_xxxx --branch fix/session-loss
oraculum init
oraculum draft tasks/fix-session-loss.md
```

This is mainly for development or internal inspection. It scaffolds the consultation without executing candidates.

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
      "invariant": "The candidate must satisfy lint checks.",
      "enforcement": "hard"
    }
  ]
}
```

Use `command` with `args` when you want an exact executable invocation. Use a shell-style command string only when that is the behavior you want.

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
- selecting a specific consultation for verdict inspection or crowning

If a workflow can be expressed without these controls, prefer the simple path.
