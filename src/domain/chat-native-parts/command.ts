import { z } from "zod";

export const commandPrefixSchema = z.literal("orc");

export const mcpToolIdSchema = z.enum([
  "oraculum_consult",
  "oraculum_plan",
  "oraculum_draft",
  "oraculum_verdict",
  "oraculum_verdict_archive",
  "oraculum_crown",
  "oraculum_init",
  "oraculum_setup_status",
]);

export const schemaReferenceSchema = z.string().min(1);

export const toolBindingSchema = z.object({
  kind: z.enum(["existing-service", "existing-command", "new-adapter-layer"]),
  module: z.string().min(1),
  symbol: z.string().min(1),
  note: z.string().min(1).optional(),
});

export const toolMetadataSchema = z.object({
  id: mcpToolIdSchema,
  purpose: z.string().min(1),
  requestShape: schemaReferenceSchema,
  responseShape: schemaReferenceSchema,
  bindings: z.array(toolBindingSchema).min(1),
  machineReadableArtifacts: z.array(z.string().min(1)).default([]),
});

export const commandArgumentKindSchema = z.enum(["string", "integer", "boolean"]);

export const commandArgumentSchema = z.object({
  name: z.string().min(1),
  kind: commandArgumentKindSchema,
  description: z.string().min(1),
  required: z.boolean().default(false),
  positional: z.boolean().default(false),
  variadic: z.boolean().default(false),
  option: z.string().min(1).optional(),
});

export const commandManifestEntrySchema = z.object({
  id: z.string().min(1),
  prefix: commandPrefixSchema,
  path: z.array(z.string().min(1)).min(1),
  summary: z.string().min(1),
  mcpTool: mcpToolIdSchema,
  requestShape: schemaReferenceSchema,
  responseShape: schemaReferenceSchema,
  arguments: z.array(commandArgumentSchema).default([]),
  examples: z.array(z.string().min(1)).min(1),
  hostAdditions: z
    .object({
      "claude-code": z.record(z.string(), z.string()).optional(),
      codex: z.record(z.string(), z.string()).optional(),
    })
    .default({}),
});

export type McpToolId = z.infer<typeof mcpToolIdSchema>;
export type ToolBinding = z.infer<typeof toolBindingSchema>;
export type ToolMetadata = z.infer<typeof toolMetadataSchema>;
export type CommandArgument = z.infer<typeof commandArgumentSchema>;
export type CommandManifestEntry = z.infer<typeof commandManifestEntrySchema>;
