import { vi } from "vitest";

export async function captureStdout(run: () => Promise<void>): Promise<string> {
  const writes: string[] = [];
  const stdoutSpy = vi.spyOn(process.stdout, "write").mockImplementation(((
    chunk: string | Uint8Array,
  ) => {
    writes.push(typeof chunk === "string" ? chunk : Buffer.from(chunk).toString("utf8"));
    return true;
  }) as typeof process.stdout.write);

  try {
    await run();
    return writes.join("");
  } finally {
    stdoutSpy.mockRestore();
  }
}
