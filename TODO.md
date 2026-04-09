# TODO

- [x] Actual monorepo e2e
  - Validated `pnpm` workspace + `turbo` + nested package structure with local `dist`
  - Confirmed `consult -> crown` in both git and copy workspace modes
  - Covered in the curated corpus and the broad `evidence:beta` matrix

- [ ] Native Windows real e2e
  - Validate `consult -> crown` on a real Windows host
  - Cover git / non-git promotion plus symlink / junction behavior
  - Note: this requires a native Windows machine, not CI alone

- [x] Timeout / hung runtime e2e
  - Simulated hung candidates and host runtime stalls for `codex` and `claude-code`
  - Confirmed consultations complete safely and no unsafe survivor is recommended

- [x] Large-diff / many-files scenario
  - Validated rename + delete + nested path changes in both git and copy modes
  - Confirmed crowning still materializes the intended survivor

- [x] Manual crown-heavy flows
  - Validated judge abstention with multiple survivors
  - Rechecked explicit `--consultation` selection and manual `crown cand-01` / `crown cand-02`

- [x] Published package smoke
  - Installed the published npm package into a temp prefix
  - Ran a `consult -> crown` happy path against the installed CLI

- [x] Long-running beta evidence corpus
  - Added a curated 12-scenario corpus on top of the broad matrix
  - Kept it focused on realistic repo/task shapes rather than combinatorial expansion
  - Broad matrix + corpus now runs as `npm run evidence:beta` and currently passes `156/156`
