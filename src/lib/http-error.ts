/** Error with an HTTP status that is safe to show to the user. Framework-independent (usable in the worker). */
export class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
    this.name = 'HttpError';
  }
}
