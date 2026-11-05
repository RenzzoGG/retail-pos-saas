import "server-only";
import nodemailer, { type Transporter } from "nodemailer";
import { getSmtpConfig } from "@/lib/env";
import type { EmailContent } from "./templates";

let transporter: Transporter | undefined;

function getTransporter(): Transporter {
  if (!transporter) {
    const config = getSmtpConfig();
    transporter = nodemailer.createTransport({
      host: config.host,
      port: config.port,
      secure: config.port === 465,
      auth: config.user ? { user: config.user, pass: config.pass } : undefined,
    });
  }
  return transporter;
}

export async function sendEmail(to: string, content: EmailContent): Promise<void> {
  await getTransporter().sendMail({
    from: getSmtpConfig().from,
    to,
    subject: content.subject,
    text: content.text,
    html: content.html,
  });
}
