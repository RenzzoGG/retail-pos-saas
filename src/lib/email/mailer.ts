import "server-only";
import nodemailer, { type Transporter } from "nodemailer";
import { getEmailConfig, type SmtpConfig } from "@/lib/env";
import { EMAIL_SEND_TIMEOUT_MS, EmailDeliveryError, type OutgoingEmail } from "./delivery";
import { sendWithResend } from "./resend";
import type { EmailContent } from "./templates";

let transporter: Transporter | undefined;

function getTransporter(config: SmtpConfig): Transporter {
  if (!transporter) {
    transporter = nodemailer.createTransport({
      host: config.host,
      port: config.port,
      secure: config.port === 465,
      auth: config.user ? { user: config.user, pass: config.pass } : undefined,
      // nodemailer's defaults are 2 min / 30 s / 10 min: a blocked port would
      // keep the request (and the "Sending…" button) waiting for minutes.
      connectionTimeout: EMAIL_SEND_TIMEOUT_MS,
      greetingTimeout: EMAIL_SEND_TIMEOUT_MS,
      socketTimeout: EMAIL_SEND_TIMEOUT_MS,
    });
  }
  return transporter;
}

async function sendWithSmtp(email: OutgoingEmail, config: SmtpConfig): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(
      () => reject(new EmailDeliveryError(`SMTP did not finish within ${EMAIL_SEND_TIMEOUT_MS} ms`, "timeout")),
      EMAIL_SEND_TIMEOUT_MS,
    );
  });
  try {
    await Promise.race([getTransporter(config).sendMail(email), deadline]);
  } catch (error) {
    if (error instanceof EmailDeliveryError) throw error;
    // Only nodemailer's error code (ETIMEDOUT, EAUTH…): its message can echo the server's reply.
    const code = (error as { code?: unknown })?.code;
    throw new EmailDeliveryError(`SMTP send failed${typeof code === "string" ? ` (${code})` : ""}`, "network");
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Sends an app email (team invitations). Resend's HTTPS API when
 * RESEND_API_KEY is set (production on Railway, which blocks SMTP), SMTP
 * otherwise (local Mailpit). Throws EmailDeliveryError within
 * EMAIL_SEND_TIMEOUT_MS when it can't be sent.
 */
export async function sendEmail(to: string, content: EmailContent): Promise<void> {
  let config: ReturnType<typeof getEmailConfig>;
  try {
    config = getEmailConfig();
  } catch {
    throw new EmailDeliveryError("Email is not configured: set RESEND_API_KEY (or SMTP_HOST and SMTP_PORT)", "config");
  }
  const email: OutgoingEmail = { from: config.from, to, subject: content.subject, text: content.text, html: content.html };
  if (config.provider === "resend") {
    await sendWithResend(email, { apiKey: config.apiKey, timeoutMs: EMAIL_SEND_TIMEOUT_MS });
  } else {
    await sendWithSmtp(email, config);
  }
}
