export function shouldUseWindowsShell(command: string): boolean {
  return process.platform === "win32" && !/[\\/]/u.test(command);
}
