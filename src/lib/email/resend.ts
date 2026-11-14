import "server-only";
import { EmailDeliveryError, type OutgoingEmail } from "./delivery";

export const RESEND_API_URL = "https://api.resend.com/emails";

export type ResendOptions = {
  apiKey: string;
  timeoutMs: number;
  /** Injected in tests. */
  fetch?: typeof fetch;
};

/**
 * Sends one email with Resend's HTTPS API (https://resend.com/docs/api-reference/emails/send-email).
 * Plain fetch, no SDK: one POST is all the app needs.
 *
 * Errors never include the API key or the request headers: only the HTTP
 * status and Resend's error name (for example "validation_error").
 */
export async function sendWithResend(email: OutgoingEmail, options: ResendOptions): Promise<void> {
  const doFetch = options.fetch ?? fetch;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), options.timeoutMs);
  try {
    let response: Response;
    try {
      response = await doFetch(RESEND_API_URL, {
        method: "POST",
        headers: { Authorization: `Bearer ${options.apiKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          from: email.from,
          to: [email.to],
          subject: email.subject,
          html: email.html,
          text: email.text,
        }),
        signal: controller.signal,
      });
    } catch {
      throw controller.signal.aborted
        ? new EmailDeliveryError(`Resend did not answer within ${options.timeoutMs} ms`, "timeout")
        : new EmailDeliveryError("Could not reach Resend", "network");
    }
    if (!response.ok) {
      const name = await errorName(response);
      throw new EmailDeliveryError(`Resend rejected the email: HTTP ${response.status}${name ? ` (${name})` : ""}`, "rejected");
    }
  } finally {
    clearTimeout(timer);
  }
}

/** Resend's error body is { statusCode, name, message }; only the short name is kept. */
async function errorName(response: Response): Promise<string | null> {
  try {
    const body = (await response.json()) as { name?: unknown };
    return typeof body.name === "string" && /^[a-z_]{1,64}$/.test(body.name) ? body.name : null;
  } catch {
    return null;
  }
}
