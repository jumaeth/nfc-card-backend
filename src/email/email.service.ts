import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Resend } from 'resend';
import nodemailer from 'nodemailer';
import { log, warn, error as logError, LogKey } from '../logger/index.js';

interface InvitationEmailData {
  companyName: string;
  inviterName: string;
  role: string;
  acceptUrl: string;
}

@Injectable()
export class EmailService {
  private readonly from: string;
  private readonly resend?: Resend;
  private readonly smtp?: nodemailer.Transporter;

  constructor(config: ConfigService) {
    this.from = config.get('EMAIL_FROM', 'noreply@taplino.ch');

    const resendKey = config.get<string>('RESEND_API_KEY');
    const smtpHost = config.get<string>('SMTP_HOST');

    if (resendKey) {
      this.resend = new Resend(resendKey);
      log(LogKey.EMAIL_RESEND_SEND, 'Resend transport initialised', { from: this.from });
    } else if (smtpHost) {
      this.smtp = nodemailer.createTransport({
        host: smtpHost,
        port: config.get<number>('SMTP_PORT', 1027),
        secure: false,
      });
      log(LogKey.EMAIL_SMTP_SEND, 'SMTP transport initialised', { host: smtpHost, from: this.from });
    } else {
      warn(LogKey.EMAIL_NO_TRANSPORT, 'No email transport configured — set RESEND_API_KEY or SMTP_HOST');
    }
  }

  async sendVerificationEmail(to: string, url: string): Promise<void> {
    await this.send(to, 'Verify your email · Taplino', verificationTemplate(url));
  }

  async sendInvitationEmail(to: string, data: InvitationEmailData): Promise<void> {
    await this.send(
      to,
      `You've been invited to join ${data.companyName} on Taplino`,
      invitationTemplate(data),
    );
  }

  async sendOtpEmail(to: string, code: string): Promise<void> {
    await this.send(to, `Your Taplino code: ${code}`, otpTemplate(code));
  }

  async sendPasswordResetOtpEmail(to: string, code: string): Promise<void> {
    await this.send(to, `Reset your Taplino password: ${code}`, passwordResetOtpTemplate(code));
  }

  private async send(to: string, subject: string, html: string): Promise<void> {
    if (this.resend) {
      const { error } = await this.resend.emails.send({ from: this.from, to, subject, html });
      if (error) {
        logError(LogKey.EMAIL_RESEND_ERROR, 'Resend send failed', { to, subject, error });
      } else {
        log(LogKey.EMAIL_RESEND_SEND, 'Email sent via Resend', { to, subject });
      }
      return;
    }
    if (this.smtp) {
      await this.smtp.sendMail({ from: this.from, to, subject, html });
      log(LogKey.EMAIL_SMTP_SEND, 'Email sent via SMTP', { to, subject });
      return;
    }
    warn(LogKey.EMAIL_NOOP, 'No transport — email skipped', { to, subject });
  }
}

// ─── Templates (Taplino styling: cream paper, ink text, orange accent) ───────

const ACCENT = '#f0431f';
const INK = '#14120f';
const MUTED = '#6c665b';

function shell(inner: string): string {
  return `<!DOCTYPE html>
<html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f6f3ec;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif">
  <table width="100%" cellpadding="0" cellspacing="0" style="padding:40px 16px"><tr><td align="center">
    <table width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;background:#fff;border-radius:22px;padding:40px;box-shadow:0 10px 40px -20px rgba(0,0,0,.25)">
      <tr><td>${inner}</td></tr>
    </table>
  </td></tr></table>
</body></html>`;
}

function button(href: string, label: string): string {
  return `<a href="${href}" style="display:inline-block;padding:12px 28px;background:${ACCENT};color:#fff;text-decoration:none;border-radius:9999px;font-size:15px;font-weight:600">${label}</a>`;
}

function verificationTemplate(url: string): string {
  return shell(`
    <p style="margin:0 0 8px;font-size:22px;font-weight:700;color:${INK}">Verify your email address</p>
    <p style="margin:0 0 28px;font-size:15px;color:${MUTED};line-height:1.5">Thanks for signing up for Taplino. Click below to verify your email and activate your account.</p>
    ${button(url, 'Verify email')}
    <p style="margin:28px 0 0;font-size:13px;color:#a1a1aa">This link expires in 24 hours. If you didn't create an account, you can safely ignore this email.</p>`);
}

function otpTemplate(code: string): string {
  return shell(`
    <p style="margin:0 0 8px;font-size:22px;font-weight:700;color:${INK}">Your verification code</p>
    <p style="margin:0 0 24px;font-size:15px;color:${MUTED};line-height:1.5">Enter this code to continue. It confirms it's really you.</p>
    <p style="margin:0 0 24px;font-size:34px;font-weight:700;letter-spacing:8px;color:${INK}">${code}</p>
    <p style="margin:0;font-size:13px;color:#a1a1aa">This code expires shortly. If you didn't request it, you can safely ignore this email.</p>`);
}

function passwordResetOtpTemplate(code: string): string {
  return shell(`
    <p style="margin:0 0 8px;font-size:22px;font-weight:700;color:${INK}">Reset your password</p>
    <p style="margin:0 0 24px;font-size:15px;color:${MUTED};line-height:1.5">Enter this code in the app to choose a new password.</p>
    <p style="margin:0 0 24px;font-size:34px;font-weight:700;letter-spacing:8px;color:${INK}">${code}</p>
    <p style="margin:0;font-size:13px;color:#a1a1aa">This code expires shortly. If you didn't request a password reset, you can safely ignore this email.</p>`);
}

function invitationTemplate(data: InvitationEmailData): string {
  const roleLabel = data.role.charAt(0) + data.role.slice(1).toLowerCase();
  return shell(`
    <p style="margin:0 0 8px;font-size:22px;font-weight:700;color:${INK}">You've been invited</p>
    <p style="margin:0 0 28px;font-size:15px;color:${MUTED};line-height:1.5"><strong>${data.inviterName}</strong> invited you to join <strong>${data.companyName}</strong> on Taplino as <strong>${roleLabel}</strong>.</p>
    ${button(data.acceptUrl, 'Accept invitation')}
    <p style="margin:28px 0 0;font-size:13px;color:#a1a1aa">This invitation expires in 7 days. If you don't have a Taplino account yet, you'll be asked to create one after clicking the link.</p>`);
}
