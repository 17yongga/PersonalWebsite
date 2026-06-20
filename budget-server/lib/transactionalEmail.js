const nodemailer = require('nodemailer');
const { SESv2Client, SendEmailCommand } = require('@aws-sdk/client-sesv2');

const DEFAULT_FROM = 'Flowt <noreply@useflowt.app>';
const DEFAULT_RESET_WEB_URL = 'https://useflowt.app/reset-password';
const DEFAULT_AWS_REGION = 'us-east-1';

function htmlEscape(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function appendToken(url, rawToken) {
  const separator = url.includes('?') ? '&' : '?';
  return `${url}${separator}token=${encodeURIComponent(rawToken)}`;
}

function buildResetPasswordEmail(rawToken, env = process.env) {
  const deepLink = `flowt://reset-password?token=${encodeURIComponent(rawToken)}`;
  const webBaseUrl = env.RESET_PASSWORD_WEB_URL || DEFAULT_RESET_WEB_URL;
  const webLink = appendToken(webBaseUrl, rawToken);

  const text = [
    'You requested a password reset for your Flowt account.',
    '',
    'Reset your password:',
    webLink,
    '',
    'If you are opening this on your iPhone, this app link may also work:',
    deepLink,
    '',
    'This link expires in 1 hour and can only be used once.',
    '',
    'If you did not request this, you can safely ignore this email.',
  ].join('\n');

  const escapedWebLink = htmlEscape(webLink);
  const escapedDeepLink = htmlEscape(deepLink);
  const html = `
    <div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;max-width:520px;margin:0 auto;padding:24px;color:#0f172a">
      <h2 style="margin:0 0 12px;color:#0f172a">Reset your Flowt password</h2>
      <p style="color:#475569;line-height:1.5">You requested a password reset for your Flowt account.</p>
      <p style="margin:24px 0">
        <a href="${escapedWebLink}"
           style="background:#2563eb;color:#fff;padding:12px 24px;border-radius:8px;text-decoration:none;font-weight:600;display:inline-block">
          Reset Password
        </a>
      </p>
      <p style="color:#475569;line-height:1.5">
        If the button does not open Flowt on your phone, copy and paste this link:<br>
        <a href="${escapedWebLink}" style="color:#2563eb;word-break:break-all">${escapedWebLink}</a>
      </p>
      <p style="color:#64748b;font-size:13px;line-height:1.5">
        iPhone app link: <a href="${escapedDeepLink}" style="color:#2563eb;word-break:break-all">${escapedDeepLink}</a>
      </p>
      <p style="color:#94a3b8;font-size:13px;line-height:1.5">
        This link expires in 1 hour and can only be used once.<br>
        If you didn't request this, ignore this email — your password won't change.
      </p>
    </div>
  `;

  return { subject: 'Reset your Flowt password', text, html, deepLink, webLink };
}

function resolveEmailConfig(env = process.env) {
  const provider = (env.EMAIL_PROVIDER || (env.NODE_ENV === 'production' ? 'ses' : '')).trim().toLowerCase();
  const from = env.EMAIL_FROM || DEFAULT_FROM;
  const region = env.AWS_REGION || env.AWS_DEFAULT_REGION || DEFAULT_AWS_REGION;

  if (provider === 'ses') {
    return { provider, from, region };
  }

  if (provider === 'smtp' || provider === 'gmail' || env.EMAIL_USER || env.EMAIL_PASS) {
    if (!env.EMAIL_USER || !env.EMAIL_PASS) {
      throw new Error('SMTP email is selected but EMAIL_USER/EMAIL_PASS are not configured');
    }
    return {
      provider: 'smtp',
      from: env.EMAIL_FROM || `"Flowt" <${env.EMAIL_USER}>`,
      smtp: { user: env.EMAIL_USER, pass: env.EMAIL_PASS },
    };
  }

  if (env.NODE_ENV === 'production') {
    throw new Error('Transactional email is not configured in production');
  }

  return { provider: 'dev-log', from, region };
}

async function sendTransactionalEmail({ to, subject, text, html, type }, options = {}) {
  if (!to) throw new Error('Email recipient is required');
  if (!subject) throw new Error('Email subject is required');
  if (!text && !html) throw new Error('Email body is required');

  const env = options.env || process.env;
  const logger = options.logger || console;
  const config = resolveEmailConfig(env);

  if (config.provider === 'dev-log') {
    logger.log(`[DEV] Transactional email skipped (${type || 'unknown'}) to ${to}: ${subject}`);
    return { provider: 'dev-log', skipped: true };
  }

  if (config.provider === 'ses') {
    const client = options.sesClient || new SESv2Client({ region: config.region });
    const command = new SendEmailCommand({
      FromEmailAddress: config.from,
      Destination: { ToAddresses: [to] },
      Content: {
        Simple: {
          Subject: { Data: subject, Charset: 'UTF-8' },
          Body: {
            Text: { Data: text || '', Charset: 'UTF-8' },
            ...(html ? { Html: { Data: html, Charset: 'UTF-8' } } : {}),
          },
        },
      },
    });
    const response = await client.send(command);
    return { provider: 'ses', messageId: response.MessageId };
  }

  if (config.provider === 'smtp') {
    const transport = options.transport || nodemailer.createTransport({
      service: 'gmail',
      auth: { user: config.smtp.user, pass: config.smtp.pass },
    });
    const response = await transport.sendMail({ from: config.from, to, subject, text, html });
    return { provider: 'smtp', messageId: response.messageId };
  }

  throw new Error(`Unsupported email provider: ${config.provider}`);
}

async function sendResetEmail(toEmail, rawToken, options = {}) {
  const content = buildResetPasswordEmail(rawToken, options.env || process.env);
  return sendTransactionalEmail({
    to: toEmail,
    subject: content.subject,
    text: content.text,
    html: content.html,
    type: 'password_reset',
  }, options);
}

module.exports = {
  DEFAULT_FROM,
  DEFAULT_RESET_WEB_URL,
  buildResetPasswordEmail,
  resolveEmailConfig,
  sendResetEmail,
  sendTransactionalEmail,
};
