# Advanced Usage

This page is for users who want more control than the default one-command flow.

The normal path is still:

```bash
oraculum run "fix session loss on refresh"
oraculum export --branch fix/session-loss
```

`run` already prints the latest summary. Use `show` only when you want to see the result again later. Use the options below only when you need them.

## Run A Task File

```bash
oraculum run tasks/fix-session-loss.md
```

`run` accepts:

- inline task text
- a Markdown task note
- a task packet path

## Choose Runtime And Candidate Count

```bash
oraculum run tasks/fix-session-loss.md --agent codex --candidates 4
```

Available runtimes today:

- `codex`
- `claude-code`

## Inspect A Specific Run

```bash
oraculum show run_20260404_xxxx
```

Without a run ID, `show` uses the latest run automatically.

## Export From A Specific Run

```bash
oraculum export --run run_20260404_xxxx --branch fix/session-loss --with-report
```

Without `--run`, `export` uses the latest exportable run automatically. Without a candidate id, it uses the recommended winner automatically.

## Manually Override The Recommended Winner

```bash
oraculum export cand-01 --run run_20260404_xxxx --branch fix/session-loss
```

Choosing a candidate id yourself is the advanced path. The default path is to let Oraculum recommend a winner and export that choice.

`export` currently writes an export plan. It does not create a real branch or PR yet.

## Report Bundle

Use `--with-report` when you want the export plan to carry report metadata for later review.

```bash
oraculum export --branch fix/session-loss --with-report
```

When available, the report bundle points at artifacts such as:

- finalist-to-finalist comparison summaries
- Markdown comparison reports
- winner selection records

This keeps the default path short while leaving richer review material in the advanced path.

## Explicit Init

```bash
oraculum init
```

You usually do not need this because `run` auto-initializes the project on first use.

## Plan Only

```bash
oraculum run tasks/fix-session-loss.md --plan-only
```

This is mainly for development or internal inspection. It scaffolds the run without executing candidates.

## Repo-Local Oracles

You can add repo-specific command checks in `.oraculum/config.json`.

Example:

```json
{
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
- `repairable`: record a failure that can later be used for bounded repair flows
- `signal`: keep the candidate alive, but record the warning

## Where Advanced Settings Belong

Quick start should stay simple.

Use advanced settings only for things like:

- choosing a specific runtime
- changing candidate count
- changing timeout budget
- adding repo-local oracle commands
- selecting a specific run for inspection or export

If a workflow can be expressed without these controls, prefer the simple path.
