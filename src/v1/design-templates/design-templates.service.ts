import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService, type TxClient } from '../../prisma/prisma.service.js';
import { CompanyAccessService } from '../companies/company-access.service.js';
import { Prisma } from '../../../generated/prisma/client.js';
import type {
  CreateDesignTemplateDto,
  UpdateDesignTemplateDto,
} from './dto/design-template.dto.js';

export const MAX_TEMPLATES_PER_COMPANY = 50;

type Db = Pick<TxClient, 'designTemplate'>;

/**
 * Saved page designs. The public methods are the customer path (membership
 * checks, RLS-scoped client). The `*In` helpers take an already-authorized
 * client so the admin console can reuse them inside `$asAdmin`.
 */
@Injectable()
export class DesignTemplatesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: CompanyAccessService,
  ) {}

  async list(companyId: string, userId: string) {
    await this.access.requireMember(userId, companyId);
    return this.listIn(this.prisma, companyId);
  }

  async create(
    companyId: string,
    userId: string,
    dto: CreateDesignTemplateDto,
  ) {
    await this.access.requireManager(userId, companyId);
    return this.createIn(this.prisma, companyId, dto);
  }

  async update(
    companyId: string,
    userId: string,
    id: string,
    dto: UpdateDesignTemplateDto,
  ) {
    await this.access.requireManager(userId, companyId);
    return this.updateIn(this.prisma, companyId, id, dto);
  }

  async remove(companyId: string, userId: string, id: string) {
    await this.access.requireManager(userId, companyId);
    await this.removeIn(this.prisma, companyId, id);
  }

  listIn(db: Db, companyId: string) {
    return db.designTemplate.findMany({
      where: { companyId },
      orderBy: { createdAt: 'asc' },
    });
  }

  async createIn(db: Db, companyId: string, dto: CreateDesignTemplateDto) {
    const count = await db.designTemplate.count({ where: { companyId } });
    if (count >= MAX_TEMPLATES_PER_COMPANY) {
      throw new BadRequestException(
        `You can keep up to ${MAX_TEMPLATES_PER_COMPANY} designs. Delete one to save a new one.`,
      );
    }
    return db.designTemplate.create({
      data: {
        companyId,
        name: dto.name.trim(),
        theme: dto.theme as Prisma.InputJsonValue,
      },
    });
  }

  async updateIn(
    db: Db,
    companyId: string,
    id: string,
    dto: UpdateDesignTemplateDto,
  ) {
    await this.requireTemplate(db, companyId, id);
    return db.designTemplate.update({
      where: { id },
      data: {
        ...(dto.name !== undefined && { name: dto.name.trim() }),
        ...(dto.theme !== undefined && {
          theme: dto.theme as Prisma.InputJsonValue,
        }),
      },
    });
  }

  async removeIn(db: Db, companyId: string, id: string) {
    await this.requireTemplate(db, companyId, id);
    await db.designTemplate.delete({ where: { id } });
  }

  private async requireTemplate(db: Db, companyId: string, id: string) {
    const template = await db.designTemplate.findUnique({ where: { id } });
    if (!template || template.companyId !== companyId) {
      throw new NotFoundException('Design not found');
    }
    return template;
  }
}
