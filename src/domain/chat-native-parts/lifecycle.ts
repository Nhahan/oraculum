import { z } from "zod";

import { adapterSchema } from "../config.js";
import { commandPrefixSchema } from "./command.js";

export const hostTransportModeSchema = z.enum(["official", "unavailable"]);

export const setupStatusActionRequestSchema = z
  .object({
    cwd: z.string().min(1),
    host: adapterSchema.optional(),
  })
  .strict();

export const hostSetupStatusSchema = z.object({
  host: adapterSchema,
  status: z.enum(["ready", "partial", "needs-setup"]),
  registered: z.boolean(),
  artifactsInstalled: z.boolean(),
  launchTransport: hostTransportModeSchema,
  nextAction: z.string().min(1),
  notes: z.array(z.string().min(1)).default([]),
});

export const setupStatusActionResponseSchema = z.object({
  mode: z.literal("setup-status"),
  cwd: z.string().min(1),
  projectInitialized: z.boolean(),
  configPath: z.string().min(1).optional(),
  advancedConfigPath: z.string().min(1).optional(),
  targetPrefix: commandPrefixSchema,
  hosts: z.array(hostSetupStatusSchema).min(1),
  summary: z.string().min(1),
});

export type HostTransportMode = z.infer<typeof hostTransportModeSchema>;
export type SetupStatusActionRequest = z.infer<typeof setupStatusActionRequestSchema>;
export type SetupStatusActionResponse = z.infer<typeof setupStatusActionResponseSchema>;
