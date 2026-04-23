export { copyManagedProjectTree } from "./managed-tree/copy.js";
export { listManagedProjectEntries } from "./managed-tree/list.js";
export {
  shouldLinkProjectDependencyTree,
  shouldManageProjectEntry,
  shouldManageProjectPath,
} from "./managed-tree/rules.js";
export {
  normalizeManagedSymlinkTarget,
  readSymlinkTargetType,
  shouldManageSymlinkTarget,
} from "./managed-tree/symlinks.js";
export type {
  ManagedPathEntry,
  ManagedPathKind,
  ManagedTreeOptions,
} from "./managed-tree/types.js";
