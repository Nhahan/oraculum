import { z } from "zod";

export const commandPrefixSchema = z.literal("orc");

export const actionIdSchema = z.enum(["consult", "plan", "verdict", "crown", "setup-status"]);

export const schemaReferenceSchema = z.string().min(1);

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
  id: actionIdSchema,
  actionId: actionIdSchema,
  prefix: commandPrefixSchema,
  path: z.array(z.string().min(1)).min(1),
  summary: z.string().min(1),
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

export type ActionId = z.infer<typeof actionIdSchema>;
export type CommandArgument = z.infer<typeof commandArgumentSchema>;
export type CommandManifestEntry = z.infer<typeof commandManifestEntrySchema>;
