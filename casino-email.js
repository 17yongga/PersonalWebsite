'use strict';

const nodemailer = require('nodemailer');
const { SESv2Client, SendEmailCommand } = require('@aws-sdk/client-sesv2');

function createCasinoMailer(env = process.env) {
  const from = env.CASINO_EMAIL_FROM || 'yonggary329@gmail.com';
  const publicUrl = String(env.CASINO_PUBLIC_URL || 'https://gary-yong.com/casino.html').replace(/\/$/, '');
  let send;
  if (env.SMTP_HOST && env.SMTP_USER && env.SMTP_PASS) {
    const transport = nodemailer.createTransport({
      host: env.SMTP_HOST,
      port: Number(env.SMTP_PORT || 587),
      secure: String(env.SMTP_SECURE || '').toLowerCase() === 'true',
      auth: { user: env.SMTP_USER, pass: env.SMTP_PASS }
    });
    send = message => transport.sendMail(message);
  } else if (env.NODE_ENV === 'test' && env.CASINO_EMAIL_PROVIDER === 'test') {
    send = async () => ({ test: true });
  } else if (env.CASINO_EMAIL_PROVIDER === 'ses') {
    const ses = new SESv2Client({ region: env.AWS_REGION || env.SES_REGION || 'us-east-1' });
    send = message => ses.send(new SendEmailCommand({
      FromEmailAddress: message.from,
      Destination: { ToAddresses: [message.to] },
      Content: { Simple: { Subject: { Data: message.subject }, Body: {
        Text: { Data: message.text }, Html: { Data: message.html }
      } } }
    }));
  } else {
    send = async () => { throw new Error('Casino email provider is not configured'); };
  }

  async function sendLink({ to, subject, heading, body, param, token }) {
    const url = new URL(publicUrl);
    url.searchParams.set(param, token);
    const href = url.toString();
    await send({
      from, to, subject,
      text: `${heading}\n\n${body}\n\n${href}\n\nIf you did not request this, ignore this email.`,
      html: `<h1>${heading}</h1><p>${body}</p><p><a href="${href}">Continue securely</a></p><p>If you did not request this, ignore this email.</p>`
    });
  }

  return {
    configured: Boolean((env.SMTP_HOST && env.SMTP_USER && env.SMTP_PASS) || env.CASINO_EMAIL_PROVIDER === 'ses' ||
      (env.NODE_ENV === 'test' && env.CASINO_EMAIL_PROVIDER === 'test')),
    sendVerification: (to, token) => sendLink({ to, token, param: 'verifyEmailToken', subject: 'Verify your NEON 777 email', heading: 'Verify your email', body: 'This link expires in 24 hours.' }),
    sendRecovery: (to, token) => sendLink({ to, token, param: 'recoveryToken', subject: 'Reset your NEON 777 password', heading: 'Reset your password', body: 'This one-time link expires in 30 minutes.' })
  };
}

module.exports = { createCasinoMailer };
