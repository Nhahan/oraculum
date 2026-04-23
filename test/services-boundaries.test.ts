import { readdir, readFile } from "node:fs/promises";
import { dirname, extname, join, relative, resolve, sep } from "node:path";
import * as ts from "typescript";
import { describe, expect, it } from "vitest";

const SERVICES_ROOT = join(process.cwd(), "src", "services");
const ALLOWED_ROOT_PROFILE_FILES = new Set(["profile-signals.ts"]);

describe("service boundaries", () => {
  it("keeps profile implementation files out of the services root", async () => {
    const entries = await readdir(SERVICES_ROOT, { withFileTypes: true });
    const disallowedRootProfileFiles = entries
      .filter(
        (entry) =>
          entry.isFile() &&
          entry.name.startsWith("profile-") &&
          entry.name.endsWith(".ts") &&
          !ALLOWED_ROOT_PROFILE_FILES.has(entry.name),
      )
      .map((entry) => `src/services/${entry.name}`)
      .sort((left, right) => left.localeCompare(right));

    expect(disallowedRootProfileFiles).toEqual([]);
  });

  it("keeps services root files as re-export facades", async () => {
    const rootFiles = (await readdir(SERVICES_ROOT, { withFileTypes: true }))
      .filter((entry) => entry.isFile() && entry.name.endsWith(".ts"))
      .map((entry) => join(SERVICES_ROOT, entry.name))
      .sort((left, right) => left.localeCompare(right));
    const implementationStatements: string[] = [];

    for (const path of rootFiles) {
      const sourceFile = ts.createSourceFile(
        path,
        await readFile(path, "utf8"),
        ts.ScriptTarget.Latest,
        true,
        ts.ScriptKind.TS,
      );

      for (const statement of sourceFile.statements) {
        if (ts.isExportDeclaration(statement)) {
          continue;
        }
        implementationStatements.push(
          `${toRepoPath(path)}:${sourceFile.getLineAndCharacterOfPosition(statement.getStart()).line + 1}:${ts.SyntaxKind[statement.kind]}`,
        );
      }
    }

    expect(implementationStatements).toEqual([]);
  });

  it("keeps domain internals from importing their own services root facade", async () => {
    const files = await listTypeScriptFiles(SERVICES_ROOT);
    const sameDomainRootImports: string[] = [];

    for (const path of files) {
      const relativePath = relative(SERVICES_ROOT, path);
      if (!relativePath.includes(sep)) {
        continue;
      }

      const domainName = relativePath.split(sep)[0];
      if (!domainName) {
        continue;
      }
      const domainRootFacade = join(SERVICES_ROOT, `${domainName}.ts`);
      const sourceFile = ts.createSourceFile(
        path,
        await readFile(path, "utf8"),
        ts.ScriptTarget.Latest,
        true,
        ts.ScriptKind.TS,
      );

      for (const specifier of collectRelativeModuleSpecifiers(sourceFile)) {
        if (resolveTypeScriptModule(path, specifier) === domainRootFacade) {
          sameDomainRootImports.push(`${toRepoPath(path)} -> ${specifier}`);
        }
      }
    }

    expect(sameDomainRootImports).toEqual([]);
  });
});

async function listTypeScriptFiles(root: string): Promise<string[]> {
  const entries = await readdir(root, { withFileTypes: true });
  const files = await Promise.all(
    entries.map(async (entry) => {
      const path = join(root, entry.name);
      if (entry.isDirectory()) {
        return listTypeScriptFiles(path);
      }
      return entry.isFile() && entry.name.endsWith(".ts") ? [path] : [];
    }),
  );

  return files.flat().sort((left, right) => left.localeCompare(right));
}

function collectRelativeModuleSpecifiers(sourceFile: ts.SourceFile): string[] {
  const specifiers: string[] = [];

  for (const statement of sourceFile.statements) {
    if (
      (ts.isImportDeclaration(statement) || ts.isExportDeclaration(statement)) &&
      statement.moduleSpecifier &&
      ts.isStringLiteral(statement.moduleSpecifier) &&
      statement.moduleSpecifier.text.startsWith(".")
    ) {
      specifiers.push(statement.moduleSpecifier.text);
    }
  }

  return specifiers;
}

function resolveTypeScriptModule(importerPath: string, specifier: string): string {
  const resolved = resolve(dirname(importerPath), specifier);
  if (resolved.endsWith(".js")) {
    return `${resolved.slice(0, -".js".length)}.ts`;
  }
  if (!extname(resolved)) {
    return `${resolved}.ts`;
  }
  return resolved;
}

function toRepoPath(path: string): string {
  return relative(process.cwd(), path).split(sep).join("/");
}
