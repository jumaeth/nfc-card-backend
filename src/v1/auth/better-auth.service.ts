import { Injectable, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { betterAuth } from 'better-auth';
import { prismaAdapter } from 'better-auth/adapters/prisma';
import { bearer, emailOTP } from 'better-auth/plugins';
import { passkey } from '@better-auth/passkey';

/**
 * Maps the better-auth endpoint that created a session to the method the user
 * authenticated with. Mirrors better-auth's own `last-login-method` resolver.
 * Used by the `session.create` hook to stamp `Session.authMethod`, which the
 * privileged-role passkey enforcement then reads. An unmapped path leaves the
 * method null, which is treated as "not passkey" (fails closed).
 */
function resolveAuthMethod(path?: string, socialProviderId?: string): string | undefined {
  if (!path) return undefined;
  if (path.startsWith('/callback/')) return socialProviderId || 'google';
  if (path === '/sign-in/email' || path === '/sign-up/email') return 'password';
  if (path === '/sign-in/email-otp') return 'email-otp';
  if (path.includes('/passkey/verify-authentication')) return 'passkey';
  return undefined;
}
import { PrismaService } from '../../prisma/prisma.service.js';
import { EmailService } from '../../email/email.service.js';
import { log, warn, LogKey } from '../../logger/index.js';

@Injectable()
export class BetterAuthService implements OnModuleInit {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private _auth!: any;

  constructor(
    private readonly config: ConfigService,
    private readonly prisma: PrismaService,
    private readonly emailService: EmailService,
  ) {}

  onModuleInit() {
    const emailService = this.emailService;

    // Web origins come from FRONTEND_URL; native apps (iOS/Android) have no web
    // origin and instead pass a custom-scheme callbackURL (e.g. `taplinoapp://`)
    // so the app can reopen itself after the web verification interstitial.
    // better-auth 403s any request whose origin/callbackURL isn't trusted, so
    // the scheme must be listed here or mobile sign-in/verification fails silently.
    const appScheme = (this.config.get<string>('APP_SCHEME') ?? 'taplinoapp://').trim();

    const trustedOrigins = [
      ...(this.config.get<string>('FRONTEND_URL') ?? '').split(','),
      ...(this.config.get<string>('TRUSTED_ORIGINS') ?? '').split(','),
      appScheme,
    ]
      .map((o) => o.trim())
      .filter(Boolean);

    // In dev, also trust any localhost/private-LAN origin so the app dev server
    // (and a phone hitting it by LAN IP to scan a pairing QR) can sign in. In
    // production only the static allowlist above is honoured. Mirrors the CORS
    // rule in main.ts — and is fail-safe the same way: only an explicit
    // NODE_ENV=development enables the dev bypass; anything else (incl. unset) is
    // treated as production.
    const isProd = (this.config.get<string>('NODE_ENV') ?? '') !== 'development';
    // `([a-z0-9-]+\.)*localhost` also trusts per-surface dev subdomains such as
    // `admin.localhost` / `app.localhost` used by the BFF proxy setup (each
    // surface gets its own origin, and therefore its own session cookie, locally).
    const devOrigin =
      /^https?:\/\/(([a-z0-9-]+\.)*localhost|127\.0\.0\.1|192\.168\.\d{1,3}\.\d{1,3}|10\.\d{1,3}\.\d{1,3}\.\d{1,3}|172\.(1[6-9]|2\d|3[01])\.\d{1,3}\.\d{1,3})(:\d+)?$/;
    const resolveTrustedOrigins = (request?: Request) => {
      const origin = request?.headers.get('origin') ?? '';
      return devOrigin.test(origin) ? [...trustedOrigins, origin] : trustedOrigins;
    };

    // Passkey (WebAuthn) relying-party config. A passkey is permanently bound to
    // its rpID (a registrable domain), so this must be the final web domain shared
    // by web + native (e.g. `app.taplino.ch`); `localhost` is dev-only and won't
    // transfer. WebAuthn origins must be concrete http(s) URLs (web) or
    // `android:apk-key-hash:…` values (native) — the custom app scheme in
    // `trustedOrigins` is not a valid WebAuthn origin, so it is filtered out here.
    // Native origins are supplied explicitly via PASSKEY_ORIGINS.
    const passkeyRpId = (this.config.get<string>('PASSKEY_RP_ID') ?? 'localhost').trim();
    const passkeyRpName = (this.config.get<string>('PASSKEY_RP_NAME') ?? 'Taplino').trim();
    const passkeyOrigins = [
      ...trustedOrigins.filter((o) => o.startsWith('http://') || o.startsWith('https://')),
      ...(this.config.get<string>('PASSKEY_ORIGINS') ?? '').split(','),
    ]
      .map((o) => o.trim())
      .filter(Boolean);

    // Anti-phishing hard requirement: WebAuthn's security depends on binding each
    // ceremony to an explicit origin allowlist. If `origin` is left empty the
    // passkey plugin silently falls back to trusting the request's own `Origin`
    // header — which a phishing page controls, defeating the whole point. Never
    // allow that: fail closed if no concrete origin is configured.
    if (passkeyOrigins.length === 0) {
      throw new Error(
        'Passkey origins not configured. Set FRONTEND_URL (web) and/or PASSKEY_ORIGINS (native) ' +
          'so WebAuthn can validate the ceremony origin.',
      );
    }

    // Google sign-in. Only enabled when credentials are configured. For native
    // (iOS/Android) id-token sign-in, Google issues a separate client ID per
    // platform; all must be trusted audiences, so `clientId` is passed as an
    // array (the web ID first — it drives the web redirect flow).
    const googleClientId = this.config.get<string>('GOOGLE_CLIENT_ID');
    const googleClientSecret = this.config.get<string>('GOOGLE_CLIENT_SECRET');
    const googleNativeIds = [
      this.config.get<string>('GOOGLE_CLIENT_ID_IOS'),
      this.config.get<string>('GOOGLE_CLIENT_ID_ANDROID'),
    ]
      .map((v) => (v ?? '').trim())
      .filter(Boolean);
    const socialProviders =
      googleClientId && googleClientSecret
        ? {
            google: {
              clientId:
                googleNativeIds.length > 0
                  ? [googleClientId, ...googleNativeIds]
                  : googleClientId,
              clientSecret: googleClientSecret,
            },
          }
        : undefined;

    this._auth = betterAuth({
      database: prismaAdapter(this.prisma.$prisma as any, {
        provider: 'postgresql',
      }),
      basePath: '/api/v1/auth',
      baseURL: this.config.getOrThrow<string>('BETTER_AUTH_URL'),
      secret: this.config.getOrThrow<string>('BETTER_AUTH_SECRET'),
      trustedOrigins: isProd ? trustedOrigins : resolveTrustedOrigins,
      // Per-IP rate limiting for /auth/**. The NestJS ThrottlerGuard can't see
      // better-auth's individual sub-paths (they're one catch-all handler), so
      // brute-force protection for sign-in / password-reset / OTP lives here.
      // The default caps every auth call; customRules tighten the credential- and
      // OTP-guessing surface (a 6-digit OTP must not be brute-forceable within its
      // 10-minute validity). Storage is in-memory (per instance) — sufficient for
      // the current single-instance deploy; move to `storage: 'database'` if the
      // service is scaled horizontally.
      rateLimit: {
        enabled: true,
        window: 60,
        max: 100,
        customRules: {
          '/sign-in/email': { window: 60, max: 10 },
          '/sign-up/email': { window: 60, max: 5 },
          '/forget-password': { window: 60, max: 5 },
          '/forget-password/email-otp': { window: 60, max: 5 },
          '/reset-password': { window: 60, max: 10 },
          '/email-otp/send-verification-otp': { window: 60, max: 5 },
          '/email-otp/verify-email': { window: 60, max: 10 },
          '/email-otp/reset-password': { window: 60, max: 10 },
          '/sign-in/email-otp': { window: 60, max: 10 },
        },
      },
      socialProviders,
      // Record on every new session HOW it was authenticated. This is the
      // authoritative signal the privileged-role passkey guard reads: a
      // password/google session cannot reach admin data until it's re-established
      // via passkey. Unmapped paths leave it null (treated as not-passkey).
      session: {
        additionalFields: {
          authMethod: { type: 'string', required: false, input: false },
        },
      },
      databaseHooks: {
        session: {
          create: {
            before: async (
              session: Record<string, unknown>,
              ctx: { path?: string; params?: { id?: string } } | null,
            ) => {
              // Reclaim: if this sign-in resolves to a soft-archived account,
              // reactivate it before the session is created. Every auth path that
              // reaches here has proven email ownership (verified sign-up, Google,
              // passkey, OTP), so this is a safe ownership check.
              const userId = session.userId;
              if (typeof userId === 'string') {
                await this.reactivateIfArchived(userId);
              }
              const method = resolveAuthMethod(ctx?.path, ctx?.params?.id);
              if (!method) return;
              return { data: { ...session, authMethod: method } };
            },
          },
        },
      },
      emailAndPassword: {
        enabled: true,
        requireEmailVerification: true,
        minPasswordLength: 8,
        maxPasswordLength: 128,
      },
      emailVerification: {
        sendOnSignIn: true,
        sendVerificationEmail: async ({ user, url }: { user: { email: string }; url: string }) => {
          const frontendOrigin = (this.config.get<string>('FRONTEND_URL') ?? '')
            .split(',')[0]
            .trim();

          // `url` points at the API's GET /verify-email endpoint, which marks the
          // email verified the moment it's fetched. Email security scanners
          // (Outlook Safe Links, Gmail, corporate proxies) GET every link in an
          // inbound message, so linking that URL directly auto-verifies the
          // account before the human ever clicks. Instead we link to a frontend
          // interstitial that only calls the endpoint on an explicit button
          // press — scanners fetch a harmless static page and can't verify.
          const src = new URL(url);
          const token = src.searchParams.get('token') ?? '';

          // Preserve the client's post-verification redirect (e.g. an invite
          // flow) when it targets the trusted web frontend OR the native app's
          // custom scheme — the mobile app deep-links back into itself via
          // `taplinoapp://…` once the interstitial verifies. Anything else falls
          // back to the web login screen.
          const rawCallback = src.searchParams.get('callbackURL') ?? '';
          const callbackURL =
            rawCallback.startsWith(frontendOrigin) || rawCallback.startsWith(appScheme)
              ? rawCallback
              : `${frontendOrigin}/login?verified=true`;

          const confirmUrl = new URL(`${frontendOrigin}/verify-email`);
          confirmUrl.searchParams.set('token', token);
          confirmUrl.searchParams.set('callbackURL', callbackURL);

          log(LogKey.AUTH_VERIFICATION_SENT, 'Sending email verification link', {
            to: user.email,
            callbackURL,
          });
          await emailService.sendVerificationEmail(user.email, confirmUrl.toString());
        },
      },
      plugins: [
        bearer(),
        // Email OTP: proves email possession. Used to authorise a privileged
        // user's FIRST passkey enrollment and recovery (a stolen password alone
        // must not be able to self-enroll a passkey). `disableSignUp` keeps this
        // from becoming an account-creation path — only existing users can use it.
        emailOTP({
          otpLength: 6,
          expiresIn: 600,
          disableSignUp: true,
          sendVerificationOTP: async ({
            email,
            otp,
            type,
          }: {
            email: string;
            otp: string;
            type: string;
          }) => {
            log(LogKey.AUTH_VERIFICATION_SENT, 'Sending email OTP', { to: email, type });
            // A `forget-password` OTP resets a lost password; every other type
            // (passkey enrollment / sign-in) is the generic possession-proof code.
            if (type === 'forget-password') {
              await emailService.sendPasswordResetOtpEmail(email, otp);
            } else {
              await emailService.sendOtpEmail(email, otp);
            }
          },
        }),
        passkey({
          rpID: passkeyRpId,
          rpName: passkeyRpName,
          origin: passkeyOrigins,
          // Require the authenticator to verify the user (Face ID / Touch ID /
          // Windows Hello / device PIN) on every ceremony so a passkey can't be
          // asserted by mere possession of an unlocked device. `residentKey`
          // stays discoverable so the usernameless "Sign in with passkey" flow
          // works.
          authenticatorSelection: {
            residentKey: 'preferred',
            userVerification: 'required',
          },
        }),
      ],
    });
  }

  /**
   * Reclaim flow. When a sign-in resolves to a soft-archived account, restore it:
   * clear the user's `deletedAt`, reactivate the memberships that were deactivated
   * on archive, and un-archive any company that was archived because this user was
   * its last member (billing stays cancelled — they re-subscribe if they want a
   * paid plan). No-op for active accounts. Best-effort: a failure is logged and
   * sign-in proceeds, so a transient DB error can't lock someone out.
   */
  private async reactivateIfArchived(userId: string): Promise<void> {
    try {
      // Cheap check on the common (active) path: a plain read, no transaction.
      // The auth tables are not RLS-scoped, so the raw client is correct here.
      const user = await this.prisma.$prisma.user.findUnique({
        where: { id: userId },
        select: { deletedAt: true },
      });
      if (!user?.deletedAt) return;

      await this.prisma.$asAdmin(async (tx) => {
        await tx.user.update({
          where: { id: userId },
          data: { deletedAt: null },
        });
        await tx.companyMember.updateMany({
          where: { userId, deactivatedAt: { not: null } },
          data: { deactivatedAt: null },
        });
        const companyIds = (
          // Companies they were removed from stay archived.
          await tx.companyMember.findMany({
            where: { userId, removedAt: null },
            select: { companyId: true },
          })
        ).map((m) => m.companyId);
        if (companyIds.length > 0) {
          await tx.company.updateMany({
            where: { id: { in: companyIds }, deletedAt: { not: null } },
            data: { deletedAt: null },
          });
        }
        log(LogKey.ACCOUNT_RECLAIMED, 'Archived account reclaimed on sign-in', {
          userId,
        });
      });
    } catch (err) {
      warn(LogKey.ACCOUNT_RECLAIM_ERROR, 'Account reclaim failed on sign-in', {
        userId,
        err: String(err),
      });
    }
  }

  get handler() {
    return this._auth.handler;
  }

  get api() {
    return this._auth.api;
  }
}
