# Advanced Usage

This page is for users who want more control than the default one-command flow.

The normal path is still:

```bash
oraculum consult "fix session loss on refresh"
oraculum promote --branch fix/session-loss
```

`consult` already prints the latest summary. Use `verdict` only when you want to see the result again later. Use the options below only when you need them.

## Consult On A Task File

```bash
oraculum consult tasks/fix-session-loss.md
```

`consult` accepts:

- inline task text
- a Markdown task note
- a task packet path

## Choose Runtime And Candidate Count

```bash
oraculum consult tasks/fix-session-loss.md --agent codex --candidates 4
```

Available runtimes today:

- `codex`
- `claude-code`

## Inspect A Specific Consultation

```bash
oraculum verdict consultation run_20260404_xxxx
```

Without a consultation id, `verdict` uses the latest consultation automatically.

## Promote From A Specific Consultation

```bash
oraculum promote --consultation run_20260404_xxxx --branch fix/session-loss --with-report
```

Without `--consultation`, `promote` uses the latest promotable consultation automatically. Without a candidate id, it uses the recommended promotion automatically.

## Manually Override The Recommended Winner

```bash
oraculum promote cand-01 --consultation run_20260404_xxxx --branch fix/session-loss
```

Choosing a candidate id yourself is the advanced path. The default path is to let Oraculum recommend a promotion and materialize that choice.

## Report Bundle

Use `--with-report` when you want the promotion record to carry report metadata for later review.

```bash
oraculum promote --branch fix/session-loss --with-report
```

In a Git-backed project, `promote` creates the target branch and applies the recommended promotion there. In a non-Git project, it syncs the promoted workspace back into the project folder.

When available, the report bundle points at artifacts such as:

- finalist-to-finalist comparison summaries
- Markdown comparison reports
- recommended promotion records

This keeps the default path short while leaving richer review material in the advanced path.

## Explicit Init

```bash
oraculum init
```

You usually do not need this because `consult` auto-initializes the project on first use.
If you run `oraculum init --force`, Oraculum resets the quick-start config and removes any existing `.oraculum/advanced.json`.

## Plan Only

```bash
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
- `repairable`: record a failure that can later be used for bounded repair flows
- `signal`: keep the candidate alive, but record the warning

## Where Advanced Settings Belong

Quick start should stay simple.

Use `.oraculum/config.json` for quick-start defaults such as:

- `defaultAgent`
- `defaultCandidates`

Use `.oraculum/advanced.json` for operator controls such as:

- repo-local oracles
- custom rounds and strategy portfolios
- future profile- or policy-level overrides

Use advanced settings only for things like:

- choosing a specific runtime
- changing candidate count
- adding repo-local oracle commands in `.oraculum/advanced.json`
- selecting a specific consultation for verdict inspection or promotion

If a workflow can be expressed without these controls, prefer the simple path.
