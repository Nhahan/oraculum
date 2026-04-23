import { z } from "zod";

import { adapterSchema } from "./config.js";

export const packagedHostArtifactFileSchema = z.object({
  path: z.string().min(1),
  purpose: z.string().min(1),
});

export const packagedHostArtifactHostLayoutSchema = z.object({
  host: adapterSchema,
  rootDir: z.string().min(1),
  files: z.array(packagedHostArtifactFileSchema).min(1),
});

export const packagedHostArtifactLayoutSchema = z.object({
  rootDir: z.string().min(1),
  commandManifestPath: z.string().min(1),
  hosts: z.array(packagedHostArtifactHostLayoutSchema).min(1),
});

export type PackagedHostArtifactFile = z.infer<typeof packagedHostArtifactFileSchema>;
export type PackagedHostArtifactHostLayout = z.infer<typeof packagedHostArtifactHostLayoutSchema>;
export type PackagedHostArtifactLayout = z.infer<typeof packagedHostArtifactLayoutSchema>;
