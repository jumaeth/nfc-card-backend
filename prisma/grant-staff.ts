import 'dotenv/config';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../generated/prisma/client.js';
import type { PlatformRole } from '../generated/prisma/client.js';

// Grants a platform (staff) role to an existing user. The admin console can only
// hand out roles once someone holds ADMIN, so this bootstraps the first one.
//   pnpm staff:grant you@taplino.ch SUPER_ADMIN
const ROLES: PlatformRole[] = ['USER', 'SALES', 'SUPPORT', 'ADMIN', 'SUPER_ADMIN'];

async function main() {
  const [email, role] = process.argv.slice(2);
  if (!email || !ROLES.includes(role as PlatformRole)) {
    throw new Error(`Usage: pnpm staff:grant <email> <${ROLES.join('|')}>`);
  }

  const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
  const prisma = new PrismaClient({ adapter });

  const existing = await prisma.user.findUnique({ where: { email: email.toLowerCase() } });
  if (!existing) throw new Error(`No user with email ${email}. They must sign up first.`);

  const user = await prisma.user.update({
    where: { id: existing.id },
    data: { platformRole: role as PlatformRole },
    select: { email: true, platformRole: true },
  });

  // eslint-disable-next-line no-console
  console.log(`${user.email} is now ${user.platformRole}.`);
  await prisma.$disconnect();
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
