/**
 * Typed error hierarchy. Every user-facing failure should be one of these so the CLI can render a
 * clean message and choose an exit code without leaking stack traces by default.
 */

export type RiqsErrorCode =
  | "CONFIG"
  | "WORKSPACE"
  | "CONTRACT"
  | "LOCK"
  | "WORKER"
  | "PROVIDER"
  | "INTEGRATION"
  | "CONSENT"
  | "GIT"
  | "CANCELLED"
  | "UNSUPPORTED"
  | "INTERNAL";

export class RiqsError extends Error {
  readonly code: RiqsErrorCode;
  readonly details?: unknown;
  readonly hint?: string;

  constructor(code: RiqsErrorCode, message: string, opts: { details?: unknown; hint?: string; cause?: unknown } = {}) {
    super(message, opts.cause !== undefined ? { cause: opts.cause } : undefined);
    this.name = "RiqsError";
    this.code = code;
    this.details = opts.details;
    this.hint = opts.hint;
  }
}

export class CancelledError extends RiqsError {
  constructor(message = "Operation cancelled") {
    super("CANCELLED", message);
    this.name = "CancelledError";
  }
}

export function isRiqsError(e: unknown): e is RiqsError {
  return e instanceof RiqsError;
}

/** Map an error code to a process exit code. */
export function exitCodeFor(code: RiqsErrorCode): number {
  switch (code) {
    case "CANCELLED":
      return 130;
    case "CONSENT":
      return 3;
    case "UNSUPPORTED":
      return 4;
    default:
      return 1;
  }
}
