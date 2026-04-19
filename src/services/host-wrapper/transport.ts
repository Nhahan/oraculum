import { directHostWrapperTransport } from "./direct.js";
import type { HostWrapperTransport } from "./types.js";

export function getDirectTransport(): HostWrapperTransport {
  return directHostWrapperTransport;
}
