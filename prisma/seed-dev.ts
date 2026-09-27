import 'dotenv/config';
import { randomUUID } from 'node:crypto';
import { PrismaPg } from '@prisma/adapter-pg';
import { hashPassword } from 'better-auth/crypto';
import { PrismaClient } from '../generated/prisma/client.js';
import type { PlanTier, PlatformRole } from '../generated/prisma/client.js';

// Local development only: seeds verified dev accounts used by the app's and the
// admin console's dev login pickers. Never run in production (`pnpm db:seed`,
// which the deploy runs, only seeds plans). Requires the plan seed first.
// Idempotent: creates what is missing and resets roles/plans on what exists.
const PASSWORD = 'taplino-dev';

// App: one business owner per plan. `dev@` is the default prefill and also a
// super admin, so one login works in both surfaces.
const CUSTOMERS: {
  email: string;
  name: string;
  role: PlatformRole;
  company: { name: string; slug: string; tier: PlanTier; salesRep?: string };
}[] = [
  {
    email: 'dev@taplino.ch',
    name: 'Dev User',
    role: 'SUPER_ADMIN',
    company: { name: 'Taplino Dev', slug: 'taplino-dev', tier: 'STARTER' },
  },
  {
    email: 'starter@taplino.ch',
    name: 'Stella Starter',
    role: 'USER',
    company: { name: 'Café Starter', slug: 'cafe-starter', tier: 'STARTER' },
  },
  {
    email: 'pro@taplino.ch',
    name: 'Paul Pro',
    role: 'USER',
    company: { name: 'Bistro Pro', slug: 'bistro-pro', tier: 'PRO', salesRep: 'sales@taplino.ch' },
  },
  {
    email: 'managed@taplino.ch',
    name: 'Mara Managed',
    role: 'USER',
    company: {
      name: 'Hotel Managed',
      slug: 'hotel-managed',
      tier: 'MANAGED',
      salesRep: 'sales@taplino.ch',
    },
  },
];

// Admin console: one account per staff role. The sales rep owns Bistro Pro and
// Hotel Managed, so its scoped view differs visibly from support/admin.
const STAFF: { email: string; name: string; role: PlatformRole }[] = [
  { email: 'superadmin@taplino.ch', name: 'Sam Superadmin', role: 'SUPER_ADMIN' },
  { email: 'admin@taplino.ch', name: 'Ada Admin', role: 'ADMIN' },
  { email: 'support@taplino.ch', name: 'Sue Support', role: 'SUPPORT' },
  { email: 'sales@taplino.ch', name: 'Sal Sales', role: 'SALES' },
];

type Tx = Parameters<Parameters<PrismaClient['$transaction']>[0]>[0];

async function ensureUser(
  tx: Tx,
  input: { email: string; name: string; role: PlatformRole },
  passwordHash: string,
): Promise<string> {
  const existing = await tx.user.findUnique({ where: { email: input.email } });
  if (existing) {
    await tx.user.update({
      where: { id: existing.id },
      data: { platformRole: input.role, emailVerified: true, deletedAt: null },
    });
    return existing.id;
  }
  // Mirrors sign-up: verified email + credential account.
  const id = randomUUID();
  await tx.user.create({
    data: { id, email: input.email, name: input.name, emailVerified: true, platformRole: input.role },
  });
  await tx.account.create({
    data: { id: randomUUID(), accountId: id, providerId: 'credential', userId: id, password: passwordHash },
  });
  return id;
}

async function ensureCompany(
  tx: Tx,
  input: { name: string; slug: string; tier: PlanTier },
  ownerId: string,
  salesRepId: string | null,
) {
  const plan = await tx.subscriptionPlan.findUnique({ where: { tier: input.tier } });
  if (!plan) throw new Error('Plans not seeded. Run pnpm db:seed first.');

  let company = await tx.company.findUnique({ where: { slug: input.slug } });
  if (!company) {
    // Mirrors bootstrapCompany (src/v1/companies/company-bootstrap.ts).
    company = await tx.company.create({
      data: { name: input.name, slug: input.slug, brandColor: '#f0431f' },
    });
    await tx.location.create({
      data: { companyId: company.id, name: 'Main', isDefault: true, country: 'CH' },
    });
    await tx.companySettings.create({ data: { companyId: company.id } });
  }

  await tx.company.update({
    where: { id: company.id },
    data: { salesRepId, deletedAt: null },
  });
  await tx.companyMember.upsert({
    where: { userId_companyId: { userId: ownerId, companyId: company.id } },
    create: { userId: ownerId, companyId: company.id, role: 'OWNER' },
    update: { role: 'OWNER', deactivatedAt: null },
  });

  const subscription = {
    planId: plan.id,
    status: 'ACTIVE' as const,
    // Starter is every company's default; paid tiers look staff-assigned.
    source: input.tier === 'STARTER' ? ('SYSTEM' as const) : ('MANUAL' as const),
    interval: plan.interval,
    currentPeriodEnd: new Date('9999-12-31'),
  };
  await tx.subscription.upsert({
    where: { companyId: company.id },
    create: { companyId: company.id, ...subscription },
    update: subscription,
  });
}

async function main() {
  if (process.env.NODE_ENV !== 'development') {
    throw new Error('seed-dev only runs with NODE_ENV=development.');
  }

  const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
  const prisma = new PrismaClient({ adapter });
  const passwordHash = await hashPassword(PASSWORD);

  // Runs under the RLS bypass like PrismaService.$asAdmin.
  await prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT set_config('app.bypass_rls', 'on', true)`;

    const staffIds = new Map<string, string>();
    for (const staff of STAFF) {
      staffIds.set(staff.email, await ensureUser(tx, staff, passwordHash));
    }
    for (const customer of CUSTOMERS) {
      const ownerId = await ensureUser(tx, customer, passwordHash);
      const repId = customer.company.salesRep ? (staffIds.get(customer.company.salesRep) ?? null) : null;
      await ensureCompany(tx, customer.company, ownerId, repId);
    }
  });

  /* eslint-disable no-console */
  console.log(`Dev accounts ready (password for all: ${PASSWORD}):`);
  for (const c of CUSTOMERS) console.log(`  app    ${c.email.padEnd(24)} ${c.company.tier}`);
  for (const s of STAFF) console.log(`  admin  ${s.email.padEnd(24)} ${s.role}`);
  /* eslint-enable no-console */
  await prisma.$disconnect();
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error(err);
  process.exit(1);
});
