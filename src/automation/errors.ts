export type AutomationService = 'chatgpt' | 'wordpress';

export class AutomationError extends Error {
  readonly retryable: boolean = true;
  constructor(message: string) {
    super(message);
    this.name = new.target.name;
  }
}

/** Session expired / not logged in / human verification needed. Task becomes LOGIN_REQUIRED, not FAILED. */
export class LoginRequiredError extends AutomationError {
  override readonly retryable = false;
  constructor(
    public readonly service: AutomationService,
    message: string,
  ) {
    super(message);
  }
}

export class AutomationTimeoutError extends AutomationError {}

/** ChatGPT did not produce a usable answer (error banner, empty output, unparseable result). */
export class GenerationError extends AutomationError {}

/** The task's saved ChatGPT conversation could not be opened; start a new one with earlier outputs as context. */
export class ConversationLostError extends AutomationError {}

/** ChatGPT usage cap reached — retrying immediately will not help. */
export class UsageLimitError extends AutomationError {
  override readonly retryable = false;
}

export class ProfileBusyError extends AutomationError {
  override readonly retryable = false;
}

export class BrowserLaunchError extends AutomationError {
  override readonly retryable = false;
}

/** Raised when something would publish a post. Never retried. */
export class PublishBlockedError extends AutomationError {
  override readonly retryable = false;
}

/** Missing website/profile/content — needs user action, retrying cannot fix it. */
export class ConfigurationError extends AutomationError {
  override readonly retryable = false;
}

export class ExtensionUpdateRequiredError extends ConfigurationError {}

export class TaskCancelledError extends Error {
  constructor() {
    super('Task was cancelled');
    this.name = 'TaskCancelledError';
  }
}

export function isRetryable(err: unknown): boolean {
  if (err instanceof TaskCancelledError) return false;
  if (err instanceof AutomationError) return err.retryable;
  const message = (err as Error)?.message ?? '';
  // Prisma / programming errors should not be hammered with retries.
  if (/PrismaClient|Invalid `prisma|TypeError|ReferenceError/.test(message)) return false;
  return true;
}
