import { z } from "zod";

import { adapterSchema } from "../config.js";
import { commandPrefixSchema } from "./command.js";

export const hostTransportModeSchema = z.enum(["official", "unavailable"]);

export const initToolRequestSchema = z.object({
  cwd: z.string().min(1),
  force: z.boolean().default(false),
});

export const initToolResponseSchema = z.object({
  mode: z.literal("init"),
  initialization: z.object({
    projectRoot: z.string().min(1),
    configPath: z.string().min(1),
    createdPaths: z.array(z.string().min(1)),
  }),
});

export const setupStatusToolRequestSchema = z.object({
  cwd: z.string().min(1),
  host: adapterSchema.optional(),
});

export const hostSetupStatusSchema = z.object({
  host: adapterSchema,
  status: z.enum(["ready", "partial", "needs-setup"]),
  registered: z.boolean(),
  artifactsInstalled: z.boolean(),
  launchTransport: hostTransportModeSchema,
  nextAction: z.string().min(1),
  notes: z.array(z.string().min(1)).default([]),
});

export const setupStatusToolResponseSchema = z.object({
  mode: z.literal("setup-status"),
  cwd: z.string().min(1),
  projectInitialized: z.boolean(),
  configPath: z.string().min(1).optional(),
  advancedConfigPath: z.string().min(1).optional(),
  targetPrefix: commandPrefixSchema,
  hosts: z.array(hostSetupStatusSchema).min(1),
  summary: z.string().min(1),
});

export type InitToolRequest = z.infer<typeof initToolRequestSchema>;
export type InitToolResponse = z.infer<typeof initToolResponseSchema>;
export type HostTransportMode = z.infer<typeof hostTransportModeSchema>;
export type SetupStatusToolRequest = z.infer<typeof setupStatusToolRequestSchema>;
export type SetupStatusToolResponse = z.infer<typeof setupStatusToolResponseSchema>;
