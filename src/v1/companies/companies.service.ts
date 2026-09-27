import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomBytes } from 'crypto';
import { PrismaService } from '../../prisma/prisma.service.js';
import { CompanyAccessService } from './company-access.service.js';
import { EmailService } from '../../email/email.service.js';
import { log, LogKey } from '../../logger/index.js';
import type { CreateCompanyDto } from './dto/create-company.dto.js';
import type { UpdateCompanyDto } from './dto/update-company.dto.js';
import type { InviteMemberDto } from './dto/invite-member.dto.js';
import type { UpdateMemberDto } from './dto/update-member.dto.js';
import type { UpdateSettingsDto } from './dto/update-settings.dto.js';

// Human-typeable code alphabet: no ambiguous characters (0/O, 1/I, etc.).
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

function generateInvitationCode(): string {
  const bytes = randomBytes(8);
  let raw = '';
  for (let i = 0; i < 8; i++) raw += CODE_ALPHABET[bytes[i]! % CODE_ALPHABET.length];
  return `${raw.slice(0, 4)}-${raw.slice(4)}`;
}

// Strips dashes/spaces and uppercases so codes are forgiving to type.
function normalizeInvitationCode(input: string): string {
  return input.trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
}

@Injectable()
export class CompaniesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: CompanyAccessService,
    private readonly email: EmailService,
    private readonly config: ConfigService,
  ) {}

  // ─── Companies ──────────────────────────────────────────────────────────────

  async create(userId: string, dto: CreateCompanyDto) {
    const existing = await this.prisma.company.findUnique({ where: { slug: dto.slug } });
    if (existing) throw new ConflictException('A company with this slug already exists');

    const starter = await this.prisma.subscriptionPlan.findUnique({
      where: { tier: 'STARTER' },
    });
    if (!starter) throw new BadRequestException('Plans not seeded. Run pnpm db:seed');

    const now = new Date();
    const farFuture = new Date('9999-12-31');

    // Bootstrap: the location, membership, settings and subscription rows are
    // inserted before/while the user becomes a member, so RLS WITH CHECK would
    // block them; run under the privileged bypass.
    const company = await this.prisma.$asAdmin(async (tx) => {
      const created = await tx.company.create({
        data: { name: dto.name, slug: dto.slug, brandColor: '#f0431f' },
      });

      // Every company starts with one default location.
      await tx.location.create({
        data: {
          companyId: created.id,
          name: 'Main',
          isDefault: true,
          country: 'CH',
        },
      });

      await tx.companyMember.create({
        data: { userId, companyId: created.id, role: 'OWNER' },
      });

      await tx.companySettings.create({
        data: { companyId: created.id },
      });

      await tx.subscription.create({
        data: {
          companyId: created.id,
          planId: starter.id,
          status: 'ACTIVE',
          source: 'SYSTEM',
          interval: 'ONE_TIME',
          currentPeriodStart: now,
          currentPeriodEnd: farFuture,
        },
      });

      return created;
    });

    log(LogKey.COMPANY_CREATED, 'Company created', {
      companyId: company.id,
      slug: company.slug,
      userId,
    });

    return company;
  }

  async listMine(userId: string) {
    const members = await this.prisma.companyMember.findMany({
      where: { userId, deactivatedAt: null, company: { deletedAt: null } },
      include: { company: { include: { subscription: { include: { plan: true } } } } },
      orderBy: { createdAt: 'asc' },
    });
    return members.map((m) => ({ ...m.company, role: m.role }));
  }

  async findOne(companyId: string, userId: string) {
    await this.access.requireMember(userId, companyId);
    const company = await this.prisma.company.findUnique({
      where: { id: companyId },
      include: {
        subscription: { include: { plan: true } },
        settings: true,
        _count: { select: { cards: true, locations: true, pages: true } },
      },
    });
    if (!company) throw new NotFoundException('Company not found');
    return company;
  }

  async update(companyId: string, userId: string, dto: UpdateCompanyDto) {
    await this.access.requireManager(userId, companyId);
    if (dto.slug) {
      const existing = await this.prisma.company.findUnique({ where: { slug: dto.slug } });
      if (existing && existing.id !== companyId) {
        throw new ConflictException('This URL identifier is already taken');
      }
    }
    return this.prisma.company.update({
      where: { id: companyId },
      data: {
        ...(dto.name !== undefined && { name: dto.name }),
        ...(dto.slug !== undefined && { slug: dto.slug }),
        ...(dto.logo !== undefined && { logo: dto.logo }),
        ...(dto.brandColor !== undefined && { brandColor: dto.brandColor }),
      },
    });
  }

  // ─── Settings ───────────────────────────────────────────────────────────────

  async getSettings(companyId: string, userId: string) {
    await this.access.requireMember(userId, companyId);
    const settings = await this.prisma.companySettings.findUnique({ where: { companyId } });
    if (settings) return settings;
    // Materialise defaults on first read so callers always get a row.
    return this.prisma.companySettings.create({ data: { companyId } });
  }

  async updateSettings(companyId: string, userId: string, dto: UpdateSettingsDto) {
    await this.access.requireManager(userId, companyId);
    return this.prisma.companySettings.upsert({
      where: { companyId },
      create: { companyId, ...dto },
      update: { ...dto },
    });
  }

  // ─── Members ────────────────────────────────────────────────────────────────

  async listMembers(companyId: string, userId: string) {
    await this.access.requireMember(userId, companyId);
    const members = await this.prisma.companyMember.findMany({
      where: { companyId, deactivatedAt: null },
      include: {
        user: { select: { id: true, name: true, email: true, avatarUrl: true } },
      },
      orderBy: { createdAt: 'asc' },
    });
    return members.map((m) => ({ ...m, role: m.role }));
  }

  async updateMember(
    companyId: string,
    requesterId: string,
    targetUserId: string,
    dto: UpdateMemberDto,
  ) {
    await this.access.requireManager(requesterId, companyId);
    if (requesterId === targetUserId) {
      throw new BadRequestException('You cannot edit your own membership');
    }

    const target = await this.prisma.companyMember.findUnique({
      where: { userId_companyId: { userId: targetUserId, companyId } },
    });
    if (!target) throw new NotFoundException('Member not found');
    if (target.role === 'OWNER') throw new ForbiddenException('Cannot edit the company owner');

    return this.prisma.companyMember.update({
      where: { userId_companyId: { userId: targetUserId, companyId } },
      data: {
        ...(dto.role !== undefined && { role: dto.role }),
        ...(dto.permissions !== undefined && { permissions: { set: dto.permissions } }),
      },
      include: {
        user: { select: { id: true, name: true, email: true, avatarUrl: true } },
      },
    });
  }

  async removeMember(companyId: string, requesterId: string, targetUserId: string) {
    await this.access.requireManager(requesterId, companyId);
    if (requesterId === targetUserId) {
      throw new BadRequestException('You cannot remove yourself');
    }

    const target = await this.prisma.companyMember.findUnique({
      where: { userId_companyId: { userId: targetUserId, companyId } },
    });
    if (!target) throw new NotFoundException('Member not found');
    if (target.role === 'OWNER') throw new ForbiddenException('Cannot remove the company owner');

    return this.prisma.companyMember.delete({
      where: { userId_companyId: { userId: targetUserId, companyId } },
    });
  }

  // ─── Invitations ────────────────────────────────────────────────────────────

  async createInvitation(companyId: string, requesterId: string, dto: InviteMemberDto) {
    await this.access.requireManager(requesterId, companyId);

    const company = await this.prisma.company.findUnique({
      where: { id: companyId },
      select: { name: true },
    });
    if (!company) throw new NotFoundException('Company not found');

    const requester = await this.prisma.user.findUnique({
      where: { id: requesterId },
      select: { name: true },
    });

    const existingMember = await this.prisma.companyMember.findFirst({
      where: { companyId, user: { email: dto.email } },
    });
    if (existingMember) {
      throw new ConflictException('This user is already a member of this company');
    }

    const existingInvitation = await this.prisma.invitation.findFirst({
      where: { companyId, email: dto.email, status: 'PENDING' },
    });
    if (existingInvitation) {
      throw new ConflictException('An active invitation already exists for this email');
    }

    const token = randomBytes(32).toString('hex');
    const code = await this.generateUniqueInvitationCode();
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
    const role = dto.role ?? 'MEMBER';

    const invitation = await this.prisma.invitation.create({
      data: {
        email: dto.email,
        companyId,
        role,
        token,
        code,
        expiresAt,
        invitedById: requesterId,
      },
    });

    const frontendUrl = this.config.getOrThrow<string>('FRONTEND_URL');
    await this.email.sendInvitationEmail(dto.email, {
      companyName: company.name,
      inviterName: requester?.name || 'Someone',
      role,
      acceptUrl: `${frontendUrl}/invite/${token}`,
    });

    log(LogKey.INVITATION_SENT, 'Invitation sent', {
      companyId,
      invitationId: invitation.id,
      email: dto.email,
    });

    return invitation;
  }

  async listInvitations(companyId: string, requesterId: string) {
    await this.access.requireManager(requesterId, companyId);
    return this.prisma.invitation.findMany({
      where: { companyId },
      include: { invitedBy: { select: { id: true, name: true, email: true } } },
      orderBy: { createdAt: 'desc' },
    });
  }

  async cancelInvitation(companyId: string, requesterId: string, invitationId: string) {
    await this.access.requireManager(requesterId, companyId);
    const invitation = await this.prisma.invitation.findUnique({
      where: { id: invitationId },
    });
    if (!invitation || invitation.companyId !== companyId) {
      throw new NotFoundException('Invitation not found');
    }
    if (invitation.status !== 'PENDING') {
      throw new BadRequestException('Invitation is not pending');
    }
    return this.prisma.invitation.update({
      where: { id: invitationId },
      data: { status: 'CANCELLED' },
    });
  }

  async getInvitationInfo(codeOrToken: string) {
    const found = await this.findInvitationByCodeOrToken(codeOrToken);
    if (!found) throw new NotFoundException('Invitation not found');
    const invitation = await this.prisma.invitation.findUnique({
      where: { id: found.id },
      include: { company: { select: { name: true } } },
    });
    if (!invitation) throw new NotFoundException('Invitation not found');
    return {
      email: invitation.email,
      companyName: invitation.company.name,
      role: invitation.role,
      status: invitation.status,
      expiresAt: invitation.expiresAt,
    };
  }

  async acceptInvitation(userId: string, codeOrToken: string) {
    const invitation = await this.findInvitationByCodeOrToken(codeOrToken);
    if (!invitation) throw new NotFoundException('Invitation not found');

    if (invitation.status !== 'PENDING') {
      throw new BadRequestException('This invitation has already been used');
    }
    if (invitation.expiresAt < new Date()) {
      throw new BadRequestException('This invitation has expired');
    }

    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new NotFoundException('User not found');
    if (user.email !== invitation.email) {
      throw new ForbiddenException('This invitation was sent to a different email address');
    }

    const existingMember = await this.prisma.companyMember.findUnique({
      where: { userId_companyId: { userId, companyId: invitation.companyId } },
    });
    if (existingMember) {
      throw new ConflictException('You are already a member of this company');
    }

    const member = await this.prisma.$transaction(async (tx) => {
      const created = await tx.companyMember.create({
        data: { userId, companyId: invitation.companyId, role: invitation.role },
        include: { company: { select: { id: true, name: true, slug: true } } },
      });
      await tx.invitation.update({
        where: { id: invitation.id },
        data: { status: 'ACCEPTED' },
      });
      return created;
    });

    log(LogKey.INVITATION_ACCEPTED, 'Invitation accepted', {
      companyId: invitation.companyId,
      invitationId: invitation.id,
      userId,
    });

    return member;
  }

  // ─── Helpers ────────────────────────────────────────────────────────────────

  private async generateUniqueInvitationCode(): Promise<string> {
    for (let attempt = 0; attempt < 5; attempt++) {
      const code = generateInvitationCode();
      const existing = await this.prisma.invitation.findUnique({ where: { code } });
      if (!existing) return code;
    }
    return generateInvitationCode();
  }

  // Resolves a manually-entered invitation code (formatted or not) or the raw
  // email-link token to a single invitation.
  private async findInvitationByCodeOrToken(input: string) {
    const trimmed = input.trim();
    const normalized = normalizeInvitationCode(trimmed);
    if (normalized.length === 8) {
      const formatted = `${normalized.slice(0, 4)}-${normalized.slice(4)}`;
      const byCode = await this.prisma.invitation.findUnique({ where: { code: formatted } });
      if (byCode) return byCode;
    }
    return this.prisma.invitation.findUnique({ where: { token: trimmed } });
  }
}
