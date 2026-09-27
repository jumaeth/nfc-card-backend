import type { TxClient } from '../../prisma/prisma.service.js';

/**
 * Creates a company with everything a tenant needs from day one: a default
 * location, settings, and the Starter plan as its SYSTEM subscription. The owner
 * membership is optional so staff can open a customer before its owner has
 * signed up (they join through an OWNER invitation).
 *
 * Must run inside `PrismaService.$asAdmin`: the child rows are written before
 * anyone is a member, so RLS WITH CHECK would reject them.
 */
export async function bootstrapCompany(
  tx: TxClient,
  input: {
    name: string;
    slug: string;
    starterPlanId: string;
    ownerUserId?: string;
    salesRepId?: string | null;
  },
) {
  const company = await tx.company.create({
    data: {
      name: input.name,
      slug: input.slug,
      brandColor: '#f0431f',
      salesRepId: input.salesRepId ?? null,
    },
  });

  await tx.location.create({
    data: { companyId: company.id, name: 'Main', isDefault: true, country: 'CH' },
  });

  if (input.ownerUserId) {
    await tx.companyMember.create({
      data: { userId: input.ownerUserId, companyId: company.id, role: 'OWNER' },
    });
  }

  await tx.companySettings.create({ data: { companyId: company.id } });

  await tx.subscription.create({
    data: {
      companyId: company.id,
      planId: input.starterPlanId,
      status: 'ACTIVE',
      source: 'SYSTEM',
      interval: 'ONE_TIME',
      currentPeriodStart: new Date(),
      currentPeriodEnd: new Date('9999-12-31'),
    },
  });

  return company;
}
