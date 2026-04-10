export const PRISMA_DEPENDENCIES = new Set(["prisma", "@prisma/client"]);
export const DRIZZLE_DEPENDENCIES = new Set(["drizzle-orm", "drizzle-kit"]);
export const KNEX_DEPENDENCIES = new Set(["knex"]);
export const SEQUELIZE_DEPENDENCIES = new Set(["sequelize"]);
export const TYPEORM_DEPENDENCIES = new Set(["typeorm"]);
export const ALEMBIC_DEPENDENCIES = new Set(["alembic"]);

export const FRONTEND_DEPENDENCIES = new Set([
  "react",
  "react-dom",
  "next",
  "vite",
  "vue",
  "nuxt",
  "svelte",
  "astro",
  "@angular/core",
]);

export const MIGRATION_DEPENDENCIES = new Set([
  ...PRISMA_DEPENDENCIES,
  ...DRIZZLE_DEPENDENCIES,
  ...KNEX_DEPENDENCIES,
  ...SEQUELIZE_DEPENDENCIES,
  ...TYPEORM_DEPENDENCIES,
  ...ALEMBIC_DEPENDENCIES,
]);

export const PLAYWRIGHT_DEPENDENCIES = new Set(["playwright", "@playwright/test"]);
export const CYPRESS_DEPENDENCIES = new Set(["cypress"]);

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
  { value: "prisma", dependencies: PRISMA_DEPENDENCIES, configPaths: PRISMA_SCHEMA_PATHS },
  { value: "drizzle", dependencies: DRIZZLE_DEPENDENCIES, configPaths: DRIZZLE_CONFIG_PATHS },
  { value: "knex", dependencies: KNEX_DEPENDENCIES, configPaths: [] },
  { value: "sequelize", dependencies: SEQUELIZE_DEPENDENCIES, configPaths: [] },
  { value: "typeorm", dependencies: TYPEORM_DEPENDENCIES, configPaths: [] },
  { value: "alembic", dependencies: ALEMBIC_DEPENDENCIES, configPaths: ALEMBIC_CONFIG_PATHS },
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
