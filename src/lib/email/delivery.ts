/** One email as the transports send it. */
export type OutgoingEmail = { from: string; to: string; subject: string; text: string; html: string };

/** Every send gives up after this long, so a request never hangs on the mail server. */
export const EMAIL_SEND_TIMEOUT_MS = 10_000;

export type EmailFailure = "config" | "timeout" | "network" | "rejected";

/**
 * A send that failed. The message is safe to log: it never contains the API
 * key, SMTP password or request headers.
 */
export class EmailDeliveryError extends Error {
  readonly reason: EmailFailure;
  constructor(message: string, reason: EmailFailure) {
    super(message);
    this.name = "EmailDeliveryError";
    this.reason = reason;
  }
}
