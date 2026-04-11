export const FRONTEND_BUILD_CONFIG_PATHS = [
  "vite.config.ts",
  "vite.config.js",
  "vite.config.mjs",
  "vite.config.cjs",
  "next.config.js",
  "next.config.mjs",
  "next.config.ts",
  "next.config.cjs",
  ".storybook/main.ts",
  ".storybook/main.js",
  ".storybook/main.mjs",
  ".storybook/main.cjs",
  "storybook/main.ts",
  "storybook/main.js",
];

export const PLAYWRIGHT_CONFIG_PATHS = [
  "playwright.config.ts",
  "playwright.config.js",
  "playwright.config.mjs",
  "playwright.config.cjs",
];

export const CYPRESS_CONFIG_PATHS = [
  "cypress.config.ts",
  "cypress.config.js",
  "cypress.config.mjs",
  "cypress.config.cjs",
];

export const E2E_CONFIG_PATHS = [...PLAYWRIGHT_CONFIG_PATHS, ...CYPRESS_CONFIG_PATHS];

export const FRONTEND_CONFIG_PATHS = [
  ...FRONTEND_BUILD_CONFIG_PATHS,
  ...PLAYWRIGHT_CONFIG_PATHS,
  ...CYPRESS_CONFIG_PATHS,
];

export const PRISMA_SCHEMA_PATHS = ["prisma/schema.prisma", "schema.prisma"];
export const PRISMA_MIGRATIONS_PATH = "prisma/migrations";

export const DRIZZLE_CONFIG_PATHS = [
  "drizzle.config.ts",
  "drizzle.config.js",
  "drizzle.config.mjs",
  "drizzle.config.cjs",
];

export const ALEMBIC_CONFIG_PATHS = ["alembic.ini"];

export const MIGRATION_CONFIG_PATHS = [
  ...PRISMA_SCHEMA_PATHS,
  ...DRIZZLE_CONFIG_PATHS,
  ...ALEMBIC_CONFIG_PATHS,
];

export const MIGRATION_SIGNAL_PATHS = [
  ...MIGRATION_CONFIG_PATHS,
  "migrations",
  "db/migrate",
  PRISMA_MIGRATIONS_PATH,
];

export const MIGRATION_TOOL_SIGNALS = [
  { value: "prisma", configPaths: PRISMA_SCHEMA_PATHS },
  { value: "drizzle", configPaths: DRIZZLE_CONFIG_PATHS },
  { value: "alembic", configPaths: ALEMBIC_CONFIG_PATHS },
] as const;

export const MIGRATION_TOOL_VALUES = MIGRATION_TOOL_SIGNALS.map((toolSignal) => toolSignal.value);

export const WORKSPACE_PARENT_DIRS = ["apps", "packages", "services", "libs"];

export const WORKSPACE_MARKER_FILES = [
  "package.json",
  "pyproject.toml",
  "go.mod",
  "Cargo.toml",
  "pom.xml",
  "build.gradle",
  "build.gradle.kts",
];

export const KNOWN_SIGNAL_PATHS = [
  "package.json",
  "tsconfig.json",
  ...FRONTEND_CONFIG_PATHS,
  ...MIGRATION_SIGNAL_PATHS,
];
