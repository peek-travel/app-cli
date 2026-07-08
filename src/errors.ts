export class CLIError extends Error {
  suggestion?: string;

  constructor(message: string, suggestion?: string) {
    super(message);
    this.name = "CLIError";
    this.suggestion = suggestion;
  }
}
