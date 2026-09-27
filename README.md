# Taplino backend

Multi-tenant NFC card platform API. NestJS 11 (ESM) + Prisma 7 + PostgreSQL, with
better-auth (email/password, Google, passkeys) and hard database-enforced tenant
isolation via Postgres Row-Level Security.

Same architecture as `zytbox-backend`: a tenant is a `Company`, which owns
`Location`s (sites), which own `Card`s (physical NFC products) and `Page`s (the
tap destinations built in the app: review, menu, link hub, vCard, wifi).

## Stack

- **NestJS 11**, ESM only (`"type": "module"`, all relative imports end in `.js`).
- **Prisma 7** with `@prisma/adapter-pg`. Client generated to `generated/prisma/`.
- **better-auth** bearer + cookie sessions, passkeys, email OTP.
- **Row-Level Security**: the app connects as the DB owner and drops into the
  restricted `taplino_app` role per query (`SET LOCAL ROLE`). Policies scope every
  tenant table to the companies the authenticated user belongs to. See
  `prisma/migrations/*_row_level_security`.

## Modules (`src/v1/`)

| Module      | Purpose |
|-------------|---------|
| `auth`      | better-auth catch-all, guard, passkey gate, decorators |
| `access`    | `GET /access` bootstrap: user + companies + passkey posture |
| `users`     | `GET/PATCH /users/me` |
| `companies` | tenant CRUD, members, invitations, settings, `CompanyAccessService` |
| `locations` | site CRUD (address, Google review target), plan-gated multi-location |
| `cards`     | physical NFC cards, slug/QR target, re-pointable destination |
| `pages`     | builder content (kind + JSON), publish |
| `analytics` | tap summary, series, top cards |
| `public`    | unauthenticated tap resolution + analytics recording |
| `billing`   | plan catalogue + resolved feature gating |
| `admin`     | staff console API (`/admin/*`): customers, cards, plans, users, roles |

## Local setup

```bash
cp .env.example .env            # then set BETTER_AUTH_SECRET (openssl rand -base64 32)
pnpm install
pnpm local:up                   # Postgres + Mailpit via docker compose
pnpm db:migrate                 # applies init + RLS migrations
pnpm db:seed                    # seeds the Starter/Pro/Managed plans
pnpm db:seed:dev                # local only: dev logins per plan (app) and per staff role (admin)
pnpm db:seed:demo               # demo business with fake data for sales demos (runs on deploy)
pnpm start:dev                  # http://localhost:3311, docs at /docs
pnpm staff:grant you@taplino.ch SUPER_ADMIN   # optional: admin console access
```

> `db:seed:dev` is idempotent and resets the dev accounts' roles and plans on every
> run. All use the password `taplino-dev`: `dev@`, `starter@`, `pro@`, `managed@`
> (app, one per plan) and `superadmin@`, `admin@`, `support@`, `sales@` (admin
> console, one per role), all `@taplino.ch`. See the app and admin READMEs.

> `db:seed:demo` creates or resets **Trattoria Sole** (Managed plan): 2 locations,
> 7 published pages in de/en/fr/it, 35 cards grouped by area, 90 days of tap
> analytics and a list of Wi-Fi guests. Login
> `demo@taplino.ch` (password `taplino-dev` locally). Production runs it on every
> deploy once the `DEMO_PASSWORD` variable is set (skipped without it), which also
> undoes changes made during demos and moves the analytics up to today.

> The plan seed is required: company creation assigns the Starter plan as the
> SYSTEM baseline. Run `pnpm db:seed` before signing up.

## Staff roles (admin console)

`User.platformRole` gates `/admin/*` via `@PlatformRoles(minimum)` + `PlatformRoleGuard`
on the ladder `USER < SALES < SUPPORT < ADMIN < SUPER_ADMIN`. SALES only sees companies
where `Company.salesRepId` is them; SUPPORT sees all read-only; ADMIN+ manages all.
Staff are not tenant members, so the admin services read and write under `$asAdmin`
and scope explicitly (`AdminCustomersService.scopeWhere` / `requireManageable`).
Every staff write is logged under `admin.action`.

The console runs as its own origin: list it in `FRONTEND_URL` after the app origin
(the first entry is used for email links).

## Notes

- Public tap routes (`/public/*`) run with no tenant context and therefore use the
  raw (RLS-bypassing) Prisma client, scoping explicitly by slug + `published`.
- Tap analytics are written from the public path via the raw client and gated by
  `CompanySettings.analyticsEnabled`.
- Stripe billing is scaffolded as plan gating only; wiring live checkout/webhooks
  is a follow-up.
