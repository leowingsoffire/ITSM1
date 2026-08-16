/**
 * SMTP integration: connection verification and test-email sending.
 * Uses `nodemailer`, driven entirely by the persisted settings document —
 * no credentials are ever hard-coded.
 */
import nodemailer from 'nodemailer';
import { badRequest } from '../lib/errors.js';

function buildTransport(smtp) {
  if (!smtp?.host) throw badRequest('SMTP host is not configured yet.');
  if (!smtp?.port) throw badRequest('SMTP port is not configured yet.');

  return nodemailer.createTransport({
    host: smtp.host,
    port: Number(smtp.port),
    secure: Boolean(smtp.secure),
    auth: smtp.username ? { user: smtp.username, pass: smtp.password } : undefined,
    connectionTimeout: 8000,
    greetingTimeout: 8000,
    socketTimeout: 8000
  });
}

/**
 * Verifies the SMTP connection/credentials without sending mail.
 * @param {object} smtp
 */
export async function verifySmtpConnection(smtp) {
  const transport = buildTransport(smtp);
  try {
    await transport.verify();
    return { verified: true };
  } catch (error) {
    throw badRequest(`Could not connect to the SMTP server: ${error.message}`);
  } finally {
    transport.close();
  }
}

/**
 * Sends a single test email using the persisted SMTP config.
 * @param {object} smtp
 * @param {string} to
 * @param {{appName?: string, companyName?: string}} [brand]
 */
export async function sendTestEmail(smtp, to, brand = {}) {
  if (!to) throw badRequest('Provide a recipient email address for the test message.');
  const fromEmail = smtp.fromEmail || smtp.username;
  if (!fromEmail) throw badRequest('Set a "from" email address before sending a test message.');

  const transport = buildTransport(smtp);
  try {
    const info = await transport.sendMail({
      from: smtp.fromName ? `"${smtp.fromName}" <${fromEmail}>` : fromEmail,
      to,
      replyTo: smtp.replyTo || undefined,
      subject: `${brand.appName ?? 'VGC OCR Intelligence'} — SMTP test`,
      text: `This is a test email from ${brand.companyName ?? brand.appName ?? 'your workspace'} confirming the SMTP settings are working.`
    });
    return { sent: true, messageId: info.messageId };
  } catch (error) {
    throw badRequest(`Failed to send the test email: ${error.message}`);
  } finally {
    transport.close();
  }
}
