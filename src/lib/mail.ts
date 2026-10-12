import nodemailer from "nodemailer";

// Email goes out through any SMTP account (Gmail app password, Brevo, Resend SMTP, school mail…).
// Set these in Netlify → Site configuration → Environment variables:
//   SMTP_HOST, SMTP_PORT (587), SMTP_USER, SMTP_PASS, MAIL_FROM ("Accounthink <you@example.com>")
// Nothing is sent, and nothing breaks, while they are missing.

export function mailStatus() {
  const missing = ["SMTP_HOST", "SMTP_USER", "SMTP_PASS", "MAIL_FROM"].filter((k) => !process.env[k]);
  return { configured: missing.length === 0, missing, from: process.env.MAIL_FROM ?? null };
}

export function siteUrl() {
  return (process.env.SITE_URL || process.env.URL || process.env.NEXT_PUBLIC_SITE_URL || "").replace(/\/$/, "");
}

let transport: ReturnType<typeof nodemailer.createTransport> | undefined;
function getTransport() {
  transport ??= nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT || 587),
    secure: Number(process.env.SMTP_PORT || 587) === 465,
    auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
    connectionTimeout: 15000,
    socketTimeout: 20000,
  });
  return transport;
}

export type Mail = { subject: string; text: string; html: string };

/**
 * Sends one email to many people. Recipients go in BCC so nobody sees anyone else's address.
 * Returns how many were accepted and any error text.
 */
export async function sendToMany(recipients: string[], mail: Mail): Promise<{ sent: number; failed: number; error?: string }> {
  const { configured } = mailStatus();
  const list = [...new Set(recipients.map((r) => r.trim().toLowerCase()).filter((r) => /^[^\s@]+@[^\s@]+$/.test(r)))];
  if (!configured) return { sent: 0, failed: list.length, error: "Email isn't set up yet." };
  if (list.length === 0) return { sent: 0, failed: 0 };

  const from = process.env.MAIL_FROM!;
  const fromAddress = from.match(/<([^>]+)>/)?.[1] ?? from;
  const BATCH = 40;
  let sent = 0;
  let failed = 0;
  let error: string | undefined;
  for (let i = 0; i < list.length; i += BATCH) {
    const batch = list.slice(i, i + BATCH);
    try {
      await getTransport().sendMail({ from, to: fromAddress, bcc: batch, ...mail });
      sent += batch.length;
    } catch (e) {
      failed += batch.length;
      error = e instanceof Error ? e.message.slice(0, 200) : "Could not send";
    }
  }
  return { sent, failed, error };
}
