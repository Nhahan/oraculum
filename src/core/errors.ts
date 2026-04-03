export class OraculumError extends Error {
  readonly exitCode: number;

  constructor(message: string, exitCode = 1) {
    super(message);
    this.name = "OraculumError";
    this.exitCode = exitCode;
  }
}
