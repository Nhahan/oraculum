# Frontier Boundary Policy

This document defines the stable boundary between Oraculum's deterministic code and the frontier model that drives consultation-time judgment.

Oraculum assumes a frontier, human-level coding model. Deterministic code should stay narrow and own only the parts that must be replayable, inspectable, and safety-critical. Semantic judgment should stay with the model unless there is a concrete reason to encode a tighter boundary.

## Deterministic Code Owns

- raw fact collection from explicit repository state
  - manifests, lockfiles, workspace markers, config files, explicit scripts, local entrypoints
- explicit-command bridging
  - mapping repo-owned commands into stable Oraculum command slots
- runtime and filesystem safety
  - workspace isolation, path rules, `relativeCwd` containment, PATH policy, wrapper resolution, timeouts, artifact persistence
- bounded product policy tables
  - default candidate counts
  - strategy defaults
  - fallback anchors
  - generated-oracle slot bundles

These rules must be deterministic because they affect execution safety, replayability, or the stable product contract.

## The Model Owns

- consultation profile choice when runtime selection is available
- which provided commands are most relevant for the task
- whether validation is sufficient for the requested change
- survivor comparison and final recommendation
- semantic interpretation of repo facts beyond the explicit deterministic boundary

The model should not be forced through unnecessary hardcoded ecosystem recipes when explicit repo evidence is already available.

## Allowed Deterministic Rules

Keep deterministic rules only when they fit one of these categories:

- `raw fact collector`
- `explicit-command bridge`
- `safety boundary`
- `compatibility field`

`compatibility field` is the narrowest allowed category. Use it only for stable product-policy tables or backwards-compatible output that still has a real downstream consumer.

## Disallowed Deterministic Rules

Do not add deterministic semantic shortcuts such as:

- dependency-only `React => frontend`
- dependency-only `Prisma => migration`
- dependency-only `tool name => executable command`
- framework- or ORM-specific built-in command recipes by default

Named tools may remain evidence, but they should not become executable behavior unless a repo-local script, explicit oracle, or tightly bounded product policy owns that behavior.

## Rule For New Deterministic Boundaries

If a new deterministic boundary is still necessary:

1. Keep it narrow.
2. Explain why the model cannot safely own it.
3. Add or update a regression test.
4. Document the rule in code comments or stable docs near the live surface.
5. Prefer updating this stable policy or the relevant module comment over growing temporary audit ledgers.

## Current Stable Product-Policy Tables

These tables are explicit product policy, not repository inference:

- `PROFILE_DEFAULT_CANDIDATES`
- `PROFILE_STRATEGIES`
- `PROFILE_FALLBACK_ANCHORS`
- `PROFILE_COMMAND_SLOTS`

They are acceptable because they operate on validated command/capability evidence after fact collection, rather than on dependency-name heuristics.

This document is now the stable summary for deterministic-boundary policy. The temporary local deterministic-boundary inventory has been retired; future boundary changes should update this document, the relevant code comments, and regression tests directly.
