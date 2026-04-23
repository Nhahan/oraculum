import type { ManagedTreeRules } from "../../domain/config.js";

export type ManagedPathKind = "dir" | "file" | "symlink";

export interface ManagedPathEntry {
  kind: ManagedPathKind;
  path: string;
}

export interface ManagedTreeOptions {
  relativeDir?: string;
  rules?: ManagedTreeRules;
}
