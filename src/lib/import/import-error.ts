export class ImportError extends Error {
  constructor(message: string, public code: string) {
    super(message);
  }
}
