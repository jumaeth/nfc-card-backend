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

interface OrderEmailData {
  number: string;
  customerName: string;
  items: { productName: string; quantity: number; lineTotalCents: number }[];
  totalCents: number;
  currency: string;
  /** Set when the order is already linked to a business in the app. */
  linkedCompanyName: string | null;
  /** Register link (guest) or the app's orders page (linked). */
  appUrl: string;
}

interface WifiCodeEmailData {
  code: string;
  businessName: string;
  ssid: string;
  locale: string;
}

interface OrderNotificationData extends OrderEmailData {
  email: string;
  adminPath: string;
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
      log(LogKey.EMAIL_RESEND_SEND, 'Resend transport initialised', {
        from: this.from,
      });
    } else if (smtpHost) {
      this.smtp = nodemailer.createTransport({
        host: smtpHost,
        port: config.get<number>('SMTP_PORT', 1027),
        secure: false,
      });
      log(LogKey.EMAIL_SMTP_SEND, 'SMTP transport initialised', {
        host: smtpHost,
        from: this.from,
      });
    } else {
      warn(
        LogKey.EMAIL_NO_TRANSPORT,
        'No email transport configured — set RESEND_API_KEY or SMTP_HOST',
      );
    }
  }

  async sendVerificationEmail(to: string, url: string): Promise<void> {
    await this.send(
      to,
      'Verify your email · Taplino',
      verificationTemplate(url),
    );
  }

  async sendInvitationEmail(
    to: string,
    data: InvitationEmailData,
  ): Promise<void> {
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
    await this.send(
      to,
      `Reset your Taplino password: ${code}`,
      passwordResetOtpTemplate(code),
    );
  }

  /** Guest Wi-Fi code, in the language the guest used on the page. */
  async sendWifiCodeEmail(to: string, data: WifiCodeEmailData): Promise<void> {
    const copy =
      WIFI_CODE_COPY[data.locale as keyof typeof WIFI_CODE_COPY] ??
      WIFI_CODE_COPY.de;
    await this.send(
      to,
      copy.subject(data.code, data.businessName),
      wifiCodeTemplate(data, copy),
    );
  }

  async sendOrderConfirmationEmail(
    to: string,
    data: OrderEmailData,
  ): Promise<void> {
    await this.send(
      to,
      `Order ${data.number} confirmed · Taplino`,
      orderConfirmationTemplate(data),
    );
  }

  async sendOrderNotificationEmail(
    to: string,
    data: OrderNotificationData,
  ): Promise<void> {
    await this.send(
      to,
      `New order ${data.number}: ${formatMoney(data.totalCents, data.currency)}`,
      orderNotificationTemplate(data),
    );
  }

  private async send(to: string, subject: string, html: string): Promise<void> {
    if (this.resend) {
      const { error } = await this.resend.emails.send({
        from: this.from,
        to,
        subject,
        html,
      });
      if (error) {
        logError(LogKey.EMAIL_RESEND_ERROR, 'Resend send failed', {
          to,
          subject,
          error,
        });
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

// ─── Templates (Taplino styling: cream paper, ink text, blue accent) ───────

const ACCENT = '#2f6df0';
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

// ─── Wi-Fi guest code ────────────────────────────────────────────────────────

const WIFI_CODE_COPY = {
  de: {
    subject: (code: string, name: string) =>
      `${code} ist dein WLAN-Code für ${name}`,
    title: 'Dein WLAN-Code',
    body: (name: string, ssid: string) =>
      `Gib diesen Code auf der Seite von <strong>${name}</strong> ein, um dich mit <strong>${ssid}</strong> zu verbinden.`,
    footer:
      'Der Code ist 10 Minuten gültig. Wenn du ihn nicht angefordert hast, kannst du diese E-Mail ignorieren.',
  },
  en: {
    subject: (code: string, name: string) =>
      `${code} is your Wi-Fi code for ${name}`,
    title: 'Your Wi-Fi code',
    body: (name: string, ssid: string) =>
      `Enter this code on the <strong>${name}</strong> page to connect to <strong>${ssid}</strong>.`,
    footer:
      "The code is valid for 10 minutes. If you didn't request it, you can ignore this email.",
  },
  fr: {
    subject: (code: string, name: string) =>
      `${code} est votre code Wi-Fi pour ${name}`,
    title: 'Votre code Wi-Fi',
    body: (name: string, ssid: string) =>
      `Saisissez ce code sur la page de <strong>${name}</strong> pour vous connecter à <strong>${ssid}</strong>.`,
    footer:
      "Le code est valable 10 minutes. Si vous ne l'avez pas demandé, ignorez cet e-mail.",
  },
  it: {
    subject: (code: string, name: string) =>
      `${code} è il tuo codice Wi-Fi per ${name}`,
    title: 'Il tuo codice Wi-Fi',
    body: (name: string, ssid: string) =>
      `Inserisci questo codice sulla pagina di <strong>${name}</strong> per connetterti a <strong>${ssid}</strong>.`,
    footer:
      'Il codice è valido 10 minuti. Se non l’hai richiesto, ignora questa e-mail.',
  },
};

function wifiCodeTemplate(
  data: WifiCodeEmailData,
  copy: (typeof WIFI_CODE_COPY)['de'],
): string {
  return shell(`
    <p style="margin:0 0 8px;font-size:22px;font-weight:700;color:${INK}">${copy.title}</p>
    <p style="margin:0 0 24px;font-size:15px;color:${MUTED};line-height:1.5">${copy.body(escapeHtml(data.businessName), escapeHtml(data.ssid))}</p>
    <p style="margin:0 0 24px;font-size:34px;font-weight:700;letter-spacing:8px;color:${INK}">${data.code}</p>
    <p style="margin:0;font-size:13px;color:#a1a1aa">${copy.footer}</p>`);
}

// ─── Shop orders ─────────────────────────────────────────────────────────────

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function formatMoney(cents: number, currency: string): string {
  return `${currency} ${(cents / 100).toFixed(2)}`;
}

function orderItemsTable(data: OrderEmailData): string {
  const rows = data.items
    .map(
      (i) => `<tr>
        <td style="padding:6px 0;font-size:14px;color:${INK}">${i.quantity} × ${escapeHtml(i.productName)}</td>
        <td style="padding:6px 0;font-size:14px;color:${INK};text-align:right">${formatMoney(i.lineTotalCents, data.currency)}</td>
      </tr>`,
    )
    .join('');
  return `<table width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 24px;border-top:1px solid #eee;border-bottom:1px solid #eee">
    ${rows}
    <tr>
      <td style="padding:10px 0 6px;font-size:14px;font-weight:700;color:${INK}">Total (incl. VAT)</td>
      <td style="padding:10px 0 6px;font-size:14px;font-weight:700;color:${INK};text-align:right">${formatMoney(data.totalCents, data.currency)}</td>
    </tr>
  </table>`;
}

function orderConfirmationTemplate(data: OrderEmailData): string {
  const next = data.linkedCompanyName
    ? `<p style="margin:0 0 24px;font-size:15px;color:${MUTED};line-height:1.5">Your cards have been added to <strong>${escapeHtml(data.linkedCompanyName)}</strong> in the Taplino app. Choose what each card opens while we produce them.</p>
    ${button(data.appUrl, 'Open your orders')}`
    : `<p style="margin:0 0 24px;font-size:15px;color:${MUTED};line-height:1.5">Create your free Taplino account with this email address to choose what your cards open, update it anytime and see tap statistics. Your order is linked automatically.</p>
    ${button(data.appUrl, 'Create your account')}`;
  return shell(`
    <p style="margin:0 0 8px;font-size:22px;font-weight:700;color:${INK}">Thanks for your order, ${escapeHtml(data.customerName)}</p>
    <p style="margin:0 0 24px;font-size:15px;color:${MUTED};line-height:1.5">We received your payment for order <strong>${escapeHtml(data.number)}</strong>. We will produce your cards and let you know when they ship.</p>
    ${orderItemsTable(data)}
    ${next}
    <p style="margin:28px 0 0;font-size:13px;color:#a1a1aa">Questions about your order? Just reply to this email.</p>`);
}

function orderNotificationTemplate(data: OrderNotificationData): string {
  return shell(`
    <p style="margin:0 0 8px;font-size:22px;font-weight:700;color:${INK}">New paid order ${escapeHtml(data.number)}</p>
    <p style="margin:0 0 24px;font-size:15px;color:${MUTED};line-height:1.5">${escapeHtml(data.customerName)} (${escapeHtml(data.email)})${
      data.linkedCompanyName
        ? `, linked to ${escapeHtml(data.linkedCompanyName)}`
        : ', not linked to an account yet'
    }.</p>
    ${orderItemsTable(data)}
    <p style="margin:0;font-size:14px;color:${MUTED}">Claim it in the admin console to fulfil it; whoever claims it becomes the customer's sales rep. Designs, shipping address and card slugs are under Orders (${escapeHtml(data.adminPath)}).</p>`);
}
