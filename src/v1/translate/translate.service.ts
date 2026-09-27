import {
  BadRequestException,
  BadGatewayException,
  ForbiddenException,
  HttpException,
  HttpStatus,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Anthropic from '@anthropic-ai/sdk';
import { CompanyAccessService } from '../companies/company-access.service.js';
import { PrismaService, type TxClient } from '../../prisma/prisma.service.js';
import { STAFF_PLATFORM_ROLES } from '../../common/permissions.js';
import type { User } from '../../../generated/prisma/client.js';
import { log, warn, error as logError, LogKey } from '../../logger/index.js';
import type {
  Locale,
  TranslateDto,
  TranslateTextDto,
} from './dto/translate.dto.js';

const MODEL = 'claude-haiku-4-5';

// Pages are set up once and then rarely change, so translation is budgeted per
// page: a company can translate this many distinct pages per calendar month...
export const PAGES_PER_MONTH = 5;
// ...and each of those pages gets this many field translations (a big menu is
// ~100 fields). At ~$0.0007 per request that caps a company near $1 a month.
export const REQUESTS_PER_PAGE_PER_MONTH = 300;

/** UTC calendar month, e.g. "2026-09". */
const currentMonth = () => new Date().toISOString().slice(0, 7);

const LANGUAGE_NAMES: Record<Locale, string> = {
  de: 'German (Switzerland)',
  en: 'English',
  fr: 'French (Switzerland)',
  it: 'Italian (Switzerland)',
};

// Kept byte-identical across requests so it stays cheap and predictable.
const SYSTEM_PROMPT = `You translate short texts for Swiss businesses: restaurant menu items and sections, and link labels on their pages.
- Translate naturally, the way a local menu would read, not word for word.
- Keep dish names that are usually left untranslated (Rösti, Tiramisù, Carpaccio, Älplermagronen) and all brand and proper names.
- Swiss German uses "ss", never "ß".
- Keep the same tone, length, capitalization style and punctuation. Do not add quotes, notes or explanations.
- If the text is already in a target language or is a name only, return it unchanged for that language.`;

/**
 * Translates one piece of page content from the language the user wrote it in
 * into the other page languages, in a single Claude Haiku call.
 */
@Injectable()
export class TranslateService {
  private readonly client?: Anthropic;

  constructor(
    config: ConfigService,
    private readonly access: CompanyAccessService,
    private readonly prisma: PrismaService,
  ) {
    const apiKey = config.get<string>('ANTHROPIC_API_KEY');
    if (apiKey) {
      this.client = new Anthropic({ apiKey });
    } else {
      warn(
        LogKey.TRANSLATE_NOT_CONFIGURED,
        'ANTHROPIC_API_KEY not set, translation is disabled',
      );
    }
  }

  /**
   * Customer path (the app): a company ADMIN+ translating one of its own pages.
   * Limited per company and page each month; staff members are exempt.
   */
  async translate(companyId: string, user: User, dto: TranslateDto) {
    // Same bar as editing a page.
    await this.access.requireManager(user.id, companyId);
    const page = await this.prisma.page.findUnique({
      where: { id: dto.pageId },
    });
    if (!page || page.deletedAt) throw new NotFoundException('Page not found');
    if (page.companyId !== companyId) throw new ForbiddenException();

    const month = currentMonth();
    const isStaff = STAFF_PLATFORM_ROLES.includes(user.platformRole);
    if (!isStaff) await this.checkQuota(companyId, page.id, month);

    const translations = await this.translateText(dto, {
      companyId,
      pageId: page.id,
      staff: isStaff,
    });
    await this.recordUsage(this.prisma, companyId, page.id);
    return { translations };
  }

  /**
   * The Claude call itself, with no access checks or usage accounting. Callers
   * must authorize the page first (see `translate` and the admin console's
   * `AdminCustomersService.translatePage`).
   */
  async translateText(
    dto: TranslateTextDto,
    meta: { companyId: string; pageId: string; staff: boolean },
  ): Promise<Partial<Record<Locale, string>>> {
    if (!this.client)
      throw new ServiceUnavailableException(
        'Translation is not available right now',
      );

    const targets = [...new Set(dto.to)].filter((l) => l !== dto.from);
    if (targets.length === 0)
      throw new BadRequestException('Pick at least one other language');

    const response = await this.client.messages
      .create({
        model: MODEL,
        max_tokens: 4096,
        system: SYSTEM_PROMPT,
        output_config: {
          format: {
            type: 'json_schema',
            schema: {
              type: 'object',
              properties: Object.fromEntries(
                targets.map((l) => [l, { type: 'string' }]),
              ),
              required: targets,
              additionalProperties: false,
            },
          },
        },
        messages: [
          {
            role: 'user',
            content: `Translate from ${LANGUAGE_NAMES[dto.from]} into ${targets
              .map((l) => `${LANGUAGE_NAMES[l]} (${l})`)
              .join(', ')}.\n\n<text>\n${dto.text}\n</text>`,
          },
        ],
      })
      .catch((err: unknown) => {
        logError(LogKey.TRANSLATE_ERROR, 'Claude request failed', {
          ...meta,
          status: err instanceof Anthropic.APIError ? err.status : undefined,
          message: err instanceof Error ? err.message : String(err),
        });
        throw new BadGatewayException('Translation failed, please try again');
      });

    const text = response.content.find((b) => b.type === 'text')?.text;
    if (response.stop_reason !== 'end_turn' || !text) {
      logError(LogKey.TRANSLATE_ERROR, 'Unexpected Claude response', {
        ...meta,
        stopReason: response.stop_reason,
      });
      throw new BadGatewayException('Translation failed, please try again');
    }

    log(LogKey.TRANSLATE_OK, 'Text translated', {
      ...meta,
      from: dto.from,
      to: targets,
      inputTokens: response.usage.input_tokens,
      outputTokens: response.usage.output_tokens,
    });
    return JSON.parse(text) as Partial<Record<Locale, string>>;
  }

  /**
   * Count one successful translation against the page's month. Staff usage is
   * recorded too (it shows real spend), it just is not limited. Pass a `$asAdmin`
   * transaction when the caller is not a member of the company.
   */
  recordUsage(
    db: Pick<TxClient, 'translationUsage'>,
    companyId: string,
    pageId: string,
  ) {
    const month = currentMonth();
    return db.translationUsage.upsert({
      where: { companyId_pageId_month: { companyId, pageId, month } },
      create: { companyId, pageId, month, requests: 1 },
      update: { requests: { increment: 1 } },
    });
  }

  /** Throws 429 when the company is out of pages, or this page out of requests, for `month`. */
  private async checkQuota(companyId: string, pageId: string, month: string) {
    const usage = await this.prisma.translationUsage.findUnique({
      where: { companyId_pageId_month: { companyId, pageId, month } },
    });

    if (!usage) {
      const pagesUsed = await this.prisma.translationUsage.count({
        where: { companyId, month },
      });
      if (pagesUsed >= PAGES_PER_MONTH) {
        this.limitReached(
          companyId,
          'pages',
          `You can auto-translate ${PAGES_PER_MONTH} pages per month. This month's limit is reached, it resets on the 1st.`,
        );
      }
    } else if (usage.requests >= REQUESTS_PER_PAGE_PER_MONTH) {
      this.limitReached(
        companyId,
        'requests',
        "This page reached this month's translation limit. It resets on the 1st.",
      );
    }
  }

  private limitReached(
    companyId: string,
    limit: 'pages' | 'requests',
    message: string,
  ): never {
    warn(LogKey.TRANSLATE_LIMIT_REACHED, 'Translation limit reached', {
      companyId,
      limit,
    });
    throw new HttpException(
      { message, code: 'TRANSLATION_LIMIT_REACHED' },
      HttpStatus.TOO_MANY_REQUESTS,
    );
  }
}
