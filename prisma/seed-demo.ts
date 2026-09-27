import 'dotenv/config';
import { randomUUID } from 'node:crypto';
import { PrismaPg } from '@prisma/adapter-pg';
import { hashPassword } from 'better-auth/crypto';
import { PrismaClient } from '../generated/prisma/client.js';
import type { CardType, PageKind, Prisma } from '../generated/prisma/client.js';

// Showcase business with fake data, used to demo Taplino to prospects: log in to
// the app as the demo account and everything (pages, cards, analytics) is filled.
// Runs on every production deploy (railway.toml). Every run resets the demo to
// this file: content edited during a demo is restored, pages/cards added during
// a demo are archived, and the tap history is regenerated so it always covers
// the last 90 days. Requires the plan seed first.
//
// DEMO_PASSWORD sets the login password (local default taplino-dev). In
// production the seed is skipped until it is set. DEMO_EMAIL overrides the
// login (default demo@taplino.ch).
const EMAIL = (process.env.DEMO_EMAIL ?? 'demo@taplino.ch').toLowerCase();
const DEV_PASSWORD = 'taplino-dev';
const COMPANY = { name: 'Trattoria Sole', slug: 'taplino-demo' };
const DAYS = 90;

type I18n = { de: string; en: string; fr: string; it: string };
const t = (de: string, en: string, fr: string, it: string): I18n => ({ de, en, fr, it });

const LOCATIONS = [
  {
    key: 'zurich',
    name: 'Zürich Niederdorf',
    isDefault: true,
    address: 'Niederdorfstrasse 12',
    postalCode: '8001',
    city: 'Zürich',
    googleReviewUrl: 'https://search.google.com/local/writereview?placeid=ChIJ-demo-taplino-zurich',
  },
  {
    key: 'bern',
    name: 'Bern Altstadt',
    isDefault: false,
    address: 'Kramgasse 45',
    postalCode: '3011',
    city: 'Bern',
    googleReviewUrl: 'https://search.google.com/local/writereview?placeid=ChIJ-demo-taplino-bern',
  },
] as const;
type LocationKey = (typeof LOCATIONS)[number]['key'];

// The "Trattoria" built-in design (nfc-card-app lib/page-theme.ts) plus identity.
const THEME = {
  brandColor: '#b5452b',
  background: '#f7efe3',
  textColor: '#2b1d14',
  surfaceColor: '#fffaf2',
  headingFont: 'playfair',
  bodyFont: 'lora',
  corners: 'rounded',
  title: t('Trattoria Sole', 'Trattoria Sole', 'Trattoria Sole', 'Trattoria Sole'),
  tagline: t(
    'Hausgemachte Pasta seit 1998',
    'Homemade pasta since 1998',
    'Pâtes maison depuis 1998',
    'Pasta fatta in casa dal 1998',
  ),
};

const item = (
  id: string,
  name: I18n,
  description: I18n,
  priceCents: number,
  extra: Record<string, unknown> = {},
) => ({ id, name, description, priceCents, available: true, ...extra });

const MENU = {
  currency: 'CHF',
  sections: [
    {
      id: 'antipasti',
      name: t('Vorspeisen', 'Starters', 'Entrées', 'Antipasti'),
      items: [
        item(
          'bruschetta',
          t('Bruschetta', 'Bruschetta', 'Bruschetta', 'Bruschetta'),
          t(
            'Geröstetes Brot, Tomaten, Basilikum, Knoblauch',
            'Toasted bread, tomatoes, basil, garlic',
            'Pain grillé, tomates, basilic, ail',
            'Pane tostato, pomodori, basilico, aglio',
          ),
          1200,
          { vegan: true, allergens: ['gluten'] },
        ),
        item(
          'burrata',
          t('Burrata', 'Burrata', 'Burrata', 'Burrata'),
          t(
            'Apulische Burrata, Kirschtomaten, Olivenöl',
            'Apulian burrata, cherry tomatoes, olive oil',
            'Burrata des Pouilles, tomates cerises, huile d’olive',
            'Burrata pugliese, pomodorini, olio d’oliva',
          ),
          1800,
          { vegetarian: true, allergens: ['milk'] },
        ),
        item(
          'vitello',
          t('Vitello tonnato', 'Vitello tonnato', 'Vitello tonnato', 'Vitello tonnato'),
          t(
            'Kalbfleisch, Thunfischsauce, Kapern',
            'Veal, tuna sauce, capers',
            'Veau, sauce au thon, câpres',
            'Vitello, salsa tonnata, capperi',
          ),
          2200,
          { allergens: ['fish', 'eggs'] },
        ),
      ],
    },
    {
      id: 'pasta',
      name: t('Pasta', 'Pasta', 'Pâtes', 'Primi'),
      items: [
        item(
          'carbonara',
          t('Spaghetti Carbonara', 'Spaghetti carbonara', 'Spaghetti carbonara', 'Spaghetti alla carbonara'),
          t(
            'Guanciale, Eigelb, Pecorino, schwarzer Pfeffer',
            'Guanciale, egg yolk, pecorino, black pepper',
            'Guanciale, jaune d’œuf, pecorino, poivre noir',
            'Guanciale, tuorlo, pecorino, pepe nero',
          ),
          2600,
          { allergens: ['gluten', 'eggs', 'milk'], tags: ['Klassiker'] },
        ),
        item(
          'arrabbiata',
          t('Penne all’Arrabbiata', 'Penne arrabbiata', 'Penne all’arrabbiata', 'Penne all’arrabbiata'),
          t(
            'Tomatensauce, Chili, Knoblauch, Petersilie',
            'Tomato sauce, chilli, garlic, parsley',
            'Sauce tomate, piment, ail, persil',
            'Salsa di pomodoro, peperoncino, aglio, prezzemolo',
          ),
          2200,
          { vegan: true, spicy: 2, allergens: ['gluten'] },
        ),
        item(
          'tagliatelle',
          t('Tagliatelle al Ragù', 'Tagliatelle al ragù', 'Tagliatelle al ragù', 'Tagliatelle al ragù'),
          t(
            'Hausgemachte Eiernudeln, 6 Stunden geschmortes Ragù',
            'Homemade egg pasta, ragù slow-cooked for 6 hours',
            'Pâtes fraîches aux œufs, ragù mijoté 6 heures',
            'Pasta all’uovo fatta in casa, ragù cotto 6 ore',
          ),
          2800,
          { allergens: ['gluten', 'eggs', 'celery'] },
        ),
        item(
          'ravioli',
          t('Ravioli Ricotta e Spinaci', 'Ricotta and spinach ravioli', 'Raviolis ricotta et épinards', 'Ravioli ricotta e spinaci'),
          t(
            'Salbeibutter, Parmesan',
            'Sage butter, parmesan',
            'Beurre à la sauge, parmesan',
            'Burro e salvia, parmigiano',
          ),
          2700,
          { vegetarian: true, allergens: ['gluten', 'eggs', 'milk'] },
        ),
      ],
    },
    {
      id: 'pizza',
      name: t('Pizza', 'Pizza', 'Pizzas', 'Pizze'),
      items: [
        item(
          'margherita',
          t('Margherita', 'Margherita', 'Margherita', 'Margherita'),
          t(
            'San-Marzano-Tomaten, Fior di Latte, Basilikum',
            'San Marzano tomatoes, fior di latte, basil',
            'Tomates San Marzano, fior di latte, basilic',
            'Pomodoro San Marzano, fior di latte, basilico',
          ),
          1900,
          { vegetarian: true, allergens: ['gluten', 'milk'] },
        ),
        item(
          'diavola',
          t('Diavola', 'Diavola', 'Diavola', 'Diavola'),
          t(
            'Scharfe Salami, Tomaten, Mozzarella, Chiliöl',
            'Spicy salami, tomatoes, mozzarella, chilli oil',
            'Salami piquant, tomates, mozzarella, huile pimentée',
            'Salame piccante, pomodoro, mozzarella, olio al peperoncino',
          ),
          2400,
          { spicy: 3, allergens: ['gluten', 'milk'] },
        ),
        item(
          'tartufo',
          t('Tartufo', 'Tartufo', 'Tartufo', 'Tartufo'),
          t(
            'Trüffelcreme, Pilze, Mozzarella, Rucola',
            'Truffle cream, mushrooms, mozzarella, rocket',
            'Crème de truffe, champignons, mozzarella, roquette',
            'Crema al tartufo, funghi, mozzarella, rucola',
          ),
          2900,
          { vegetarian: true, allergens: ['gluten', 'milk'], available: false },
        ),
      ],
    },
    {
      id: 'dolci',
      name: t('Desserts', 'Desserts', 'Desserts', 'Dolci'),
      items: [
        item(
          'tiramisu',
          t('Tiramisù', 'Tiramisù', 'Tiramisù', 'Tiramisù'),
          t(
            'Nach dem Rezept der Nonna',
            'Made to nonna’s recipe',
            'Selon la recette de la nonna',
            'Secondo la ricetta della nonna',
          ),
          1100,
          { vegetarian: true, allergens: ['gluten', 'eggs', 'milk'] },
        ),
        item(
          'panna-cotta',
          t('Panna cotta', 'Panna cotta', 'Panna cotta', 'Panna cotta'),
          t('Mit Beerenragout', 'With berry compote', 'Au coulis de baies', 'Con frutti di bosco'),
          950,
          { vegetarian: true, allergens: ['milk'] },
        ),
      ],
    },
  ],
};

const PAGES: {
  slug: string;
  name: string;
  kind: PageKind;
  location: LocationKey | null;
  content: Record<string, unknown>;
}[] = [
  { slug: 'taplino-demo-menu', name: 'Speisekarte Zürich', kind: 'MENU', location: 'zurich', content: MENU },
  { slug: 'taplino-demo-menu-bern', name: 'Speisekarte Bern', kind: 'MENU', location: 'bern', content: MENU },
  {
    slug: 'taplino-demo-review',
    name: 'Google-Bewertung Zürich',
    kind: 'REVIEW',
    location: 'zurich',
    content: {
      provider: 'google',
      reviewUrl: LOCATIONS[0].googleReviewUrl,
      threshold: 4,
      collectNegativeInternally: true,
      feedbackEmail: EMAIL,
    },
  },
  {
    slug: 'taplino-demo-review-bern',
    name: 'Google-Bewertung Bern',
    kind: 'REVIEW',
    location: 'bern',
    content: {
      provider: 'google',
      reviewUrl: LOCATIONS[1].googleReviewUrl,
      threshold: 4,
      collectNegativeInternally: true,
      feedbackEmail: EMAIL,
    },
  },
  {
    slug: 'taplino-demo-links',
    name: 'Links',
    kind: 'LINKHUB',
    location: null,
    content: {
      headline: t(
        'Schön, dass du da bist!',
        'Great to have you here!',
        'Ravis de vous voir !',
        'Che bello averti qui!',
      ),
      links: [
        { id: 'reserve', label: t('Tisch reservieren', 'Book a table', 'Réserver une table', 'Prenota un tavolo'), url: 'https://example.com/reservieren' },
        { id: 'menu', label: t('Speisekarte', 'Menu', 'Menu', 'Menù'), url: '/p/taplino-demo-menu' },
        { id: 'wifi', label: t('Gäste-WLAN', 'Guest Wi-Fi', 'Wi-Fi invités', 'Wi-Fi ospiti'), url: '/p/taplino-demo-wifi' },
        { id: 'review', label: t('Bewerte uns', 'Rate us', 'Donnez votre avis', 'Lasciaci una recensione'), url: '/p/taplino-demo-review' },
        { id: 'voucher', label: t('Gutschein verschenken', 'Gift a voucher', 'Offrir un bon', 'Regala un buono'), url: 'https://example.com/gutschein' },
        { id: 'catering', label: t('Catering anfragen', 'Catering enquiry', 'Demande de traiteur', 'Richiedi catering'), url: 'https://example.com/catering' },
      ],
      socials: [
        { platform: 'instagram', url: 'https://instagram.com/example' },
        { platform: 'facebook', url: 'https://facebook.com/example' },
        { platform: 'tiktok', url: 'https://tiktok.com/@example' },
      ],
    },
  },
  {
    slug: 'taplino-demo-kontakt',
    name: 'Visitenkarte Giulia',
    kind: 'VCARD',
    location: null,
    content: {
      firstName: 'Giulia',
      lastName: 'Rossi',
      org: 'Trattoria Sole',
      title: 'Inhaberin',
      phones: [
        { label: 'Mobile', number: '+41 79 000 00 00' },
        { label: 'Restaurant', number: '+41 44 000 00 00' },
      ],
      emails: [{ label: 'Work', address: 'giulia@example.com' }],
      website: 'https://example.com',
      address: 'Niederdorfstrasse 12, 8001 Zürich',
      socials: [{ platform: 'linkedin', url: 'https://linkedin.com/in/example' }],
    },
  },
  {
    slug: 'taplino-demo-wifi',
    name: 'Gäste-WLAN',
    kind: 'WIFI',
    location: 'zurich',
    content: {
      ssid: 'Sole-Gaeste',
      password: 'buonappetito',
      encryption: 'WPA',
      hidden: false,
      guestAccess: {
        mode: 'verify',
        marketing: true,
        privacyUrl: 'https://example.com/datenschutz',
        contactEmail: 'datenschutz@example.com',
      },
    },
  },
];

// Cards and their relative tap volume (weights). Zürich has 20 tables in two
// areas, so the card list shows grouping by location and area. The spare is in
// stock but not yet pointed anywhere.
type DemoCard = {
  slug: string;
  name: string;
  type: CardType;
  location: LocationKey | null;
  area?: string;
  page: string | null;
  weight: number;
};
const table = (
  location: LocationKey,
  area: string,
  n: number,
  page: string,
  weight: number,
): DemoCard => ({
  slug: `taplino-demo-${location}-t${n}`,
  name: `Tisch ${n}`,
  type: 'MENU',
  location,
  area,
  page,
  weight,
});
const CARDS: DemoCard[] = [
  ...Array.from({ length: 12 }, (_, i) => table('zurich', 'Saal', i + 1, 'taplino-demo-menu', 4)),
  ...Array.from({ length: 8 }, (_, i) => table('zurich', 'Terrasse', i + 13, 'taplino-demo-menu', 3)),
  { slug: 'taplino-demo-bar', name: 'Bar', type: 'MENU', location: 'zurich', area: 'Bar', page: 'taplino-demo-menu', weight: 7 },
  { slug: 'taplino-demo-kasse', name: 'Kasse Zürich', type: 'REVIEW', location: 'zurich', area: 'Eingang', page: 'taplino-demo-review', weight: 11 },
  { slug: 'taplino-demo-wlan', name: 'WLAN-Aufsteller', type: 'WIFI', location: 'zurich', area: 'Eingang', page: 'taplino-demo-wifi', weight: 6 },
  { slug: 'taplino-demo-links-card', name: 'Schaufenster', type: 'LINKHUB', location: 'zurich', area: 'Eingang', page: 'taplino-demo-links', weight: 4 },
  ...Array.from({ length: 8 }, (_, i) => table('bern', 'Gaststube', i + 1, 'taplino-demo-menu-bern', 2)),
  { slug: 'taplino-demo-bern-kasse', name: 'Kasse Bern', type: 'REVIEW', location: 'bern', page: 'taplino-demo-review-bern', weight: 6 },
  { slug: 'taplino-demo-giulia', name: 'Visitenkarte Giulia', type: 'VCARD', location: null, page: 'taplino-demo-kontakt', weight: 3 },
  { slug: 'taplino-demo-spare', name: 'Ersatzkarte', type: 'REVIEW', location: 'zurich', page: null, weight: 0 },
];

// Deterministic PRNG so every reset yields the same-looking analytics.
function mulberry32(seed: number) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let r = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    r = (r + Math.imul(r ^ (r >>> 7), 61 | r)) ^ r;
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}

function pick<T>(rand: () => number, weighted: [T, number][]): T {
  const total = weighted.reduce((s, [, w]) => s + w, 0);
  let x = rand() * total;
  for (const [value, w] of weighted) {
    x -= w;
    if (x < 0) return value;
  }
  return weighted[weighted.length - 1][0];
}

const COUNTRIES: [string, number][] = [['CH', 72], ['DE', 10], ['IT', 6], ['FR', 4], ['AT', 3], ['US', 3], ['GB', 2]];
const DEVICES: [string, number][] = [['ios', 58], ['android', 36], ['desktop', 6]];
// Restaurant traffic: busier on Friday/Saturday, quiet on Monday.
const WEEKDAY: number[] = [0.9, 0.6, 0.8, 0.9, 1.1, 1.5, 1.4]; // Sun..Sat
// Lunch and dinner peaks (local hour, weight).
const HOURS: [number, number][] = [[11, 3], [12, 9], [13, 6], [14, 2], [17, 2], [18, 6], [19, 9], [20, 7], [21, 3]];

// Fake guest addresses (all @example.com, so nothing is ever sent).
const GUEST_NAMES = [
  'anna.meier', 'luca.bianchi', 'sophie.muller', 'marco.keller', 'lea.schmid', 'noah.weber',
  'emma.huber', 'elias.fischer', 'mia.brunner', 'leon.baumann', 'lina.frei', 'finn.gerber',
  'julia.roth', 'david.zimmermann', 'chiara.rossi', 'tim.steiner', 'nina.graf', 'jan.wyss',
  'sara.moser', 'luis.kaufmann', 'clara.marti', 'ben.hofmann', 'laura.suter', 'nico.lehmann',
  'amelie.dubois', 'paul.berger', 'zoe.kunz', 'samuel.vogel', 'alina.egli', 'jonas.bachmann',
  'giulia.ferrari', 'max.widmer', 'elena.hess', 'tom.koch', 'lara.schneider', 'oliver.smith',
];

type Tx = Parameters<Parameters<PrismaClient['$transaction']>[0]>[0];

async function ensureUser(tx: Tx, password: string): Promise<string> {
  const existing = await tx.user.findUnique({ where: { email: EMAIL } });
  const passwordHash = await hashPassword(password);
  if (existing) {
    await tx.user.update({
      where: { id: existing.id },
      data: { emailVerified: true, deletedAt: null },
    });
    const updated = await tx.account.updateMany({
      where: { userId: existing.id, providerId: 'credential' },
      data: { password: passwordHash },
    });
    if (updated.count === 0) {
      await tx.account.create({
        data: { id: randomUUID(), accountId: existing.id, providerId: 'credential', userId: existing.id, password: passwordHash },
      });
    }
    return existing.id;
  }
  const id = randomUUID();
  await tx.user.create({
    data: { id, email: EMAIL, name: 'Giulia Rossi (Demo)', emailVerified: true, platformRole: 'USER' },
  });
  await tx.account.create({
    data: { id: randomUUID(), accountId: id, providerId: 'credential', userId: id, password: passwordHash },
  });
  return id;
}

async function main() {
  const production = process.env.NODE_ENV === 'production';
  const password = process.env.DEMO_PASSWORD || (production ? null : DEV_PASSWORD);
  if (!password) {
    // eslint-disable-next-line no-console
    console.log('Demo business skipped: set DEMO_PASSWORD to seed it.');
    return;
  }

  const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
  const prisma = new PrismaClient({ adapter });

  let taps = 0;
  // Runs under the RLS bypass like PrismaService.$asAdmin.
  await prisma.$transaction(
    async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.bypass_rls', 'on', true)`;

      const plan = await tx.subscriptionPlan.findUnique({ where: { tier: 'MANAGED' } });
      if (!plan) throw new Error('Plans not seeded. Run pnpm db:seed first.');

      const ownerId = await ensureUser(tx, password);

      // ─── Company ─────────────────────────────────────────────────────────
      const company = await tx.company.upsert({
        where: { slug: COMPANY.slug },
        create: { ...COMPANY, brandColor: THEME.brandColor, billingEmail: EMAIL },
        update: { name: COMPANY.name, brandColor: THEME.brandColor, deletedAt: null },
      });
      const companyId = company.id;

      await tx.companySettings.upsert({
        where: { companyId },
        create: { companyId, analyticsEnabled: true, defaultLocale: 'de' },
        update: { analyticsEnabled: true, defaultLocale: 'de' },
      });
      await tx.companyMember.upsert({
        where: { userId_companyId: { userId: ownerId, companyId } },
        create: { userId: ownerId, companyId, role: 'OWNER' },
        update: { role: 'OWNER', deactivatedAt: null, removedAt: null },
      });
      const subscription = {
        planId: plan.id,
        status: 'ACTIVE' as const,
        source: 'MANUAL' as const,
        interval: plan.interval,
        currentPeriodEnd: new Date('9999-12-31'),
      };
      await tx.subscription.upsert({
        where: { companyId },
        create: { companyId, ...subscription },
        update: subscription,
      });

      // ─── Locations ───────────────────────────────────────────────────────
      const locationIds = new Map<LocationKey, string>();
      const existingLocations = await tx.location.findMany({ where: { companyId } });
      for (const { key, ...loc } of LOCATIONS) {
        const data = { ...loc, country: 'CH', timezone: 'Europe/Zurich', deletedAt: null };
        const match = existingLocations.find((l) => l.name === loc.name);
        const row = match
          ? await tx.location.update({ where: { id: match.id }, data })
          : await tx.location.create({ data: { ...data, companyId } });
        locationIds.set(key, row.id);
      }
      await tx.location.updateMany({
        where: { companyId, id: { notIn: [...locationIds.values()] }, deletedAt: null },
        data: { deletedAt: new Date(), isDefault: false },
      });

      // ─── Pages ───────────────────────────────────────────────────────────
      const pageIds = new Map<string, { id: string; kind: PageKind }>();
      for (const p of PAGES) {
        const data = {
          name: p.name,
          kind: p.kind,
          published: true,
          content: p.content as Prisma.InputJsonValue,
          theme: THEME as Prisma.InputJsonValue,
          locationId: p.location ? locationIds.get(p.location)! : null,
          deletedAt: null,
        };
        const existing = await tx.page.findUnique({ where: { slug: p.slug } });
        if (existing && existing.companyId !== companyId) {
          throw new Error(`Page slug ${p.slug} belongs to another company.`);
        }
        const row = existing
          ? await tx.page.update({ where: { id: existing.id }, data })
          : await tx.page.create({ data: { ...data, slug: p.slug, companyId } });
        pageIds.set(p.slug, { id: row.id, kind: row.kind });
      }
      // Link hub entries to our own pages carry the page id (the builder's page picker).
      const hub = PAGES.find((p) => p.kind === 'LINKHUB')!;
      const hubLinks = (hub.content.links as { url: string }[]).map((l) => {
        const own = l.url.startsWith('/p/') ? pageIds.get(l.url.slice(3)) : undefined;
        return own ? { ...l, pageId: own.id } : l;
      });
      await tx.page.update({
        where: { id: pageIds.get(hub.slug)!.id },
        data: { content: { ...hub.content, links: hubLinks } as Prisma.InputJsonValue },
      });

      const keptPageIds = [...pageIds.values()].map((p) => p.id);
      await tx.page.updateMany({
        where: { companyId, id: { notIn: keptPageIds }, deletedAt: null },
        data: { deletedAt: new Date(), published: false },
      });

      await tx.designTemplate.deleteMany({ where: { companyId } });
      await tx.designTemplate.create({
        data: { companyId, name: 'Sole Hausstil', theme: THEME as Prisma.InputJsonValue },
      });

      // ─── Cards ───────────────────────────────────────────────────────────
      const cardRows: { id: string; pageId: string; kind: PageKind; weight: number }[] = [];
      for (const c of CARDS) {
        const page = c.page ? pageIds.get(c.page)! : null;
        const data = {
          name: c.name,
          type: c.type,
          status: page ? ('ACTIVE' as const) : ('UNASSIGNED' as const),
          locationId: c.location ? locationIds.get(c.location)! : null,
          area: c.area ?? null,
          activePageId: page?.id ?? null,
          deletedAt: null,
        };
        const existing = await tx.card.findUnique({ where: { slug: c.slug } });
        if (existing && existing.companyId !== companyId) {
          throw new Error(`Card slug ${c.slug} belongs to another company.`);
        }
        const row = existing
          ? await tx.card.update({ where: { id: existing.id }, data })
          : await tx.card.create({ data: { ...data, slug: c.slug, companyId } });
        if (page) cardRows.push({ id: row.id, pageId: page.id, kind: page.kind, weight: c.weight });
      }
      await tx.card.updateMany({
        where: { companyId, slug: { notIn: CARDS.map((c) => c.slug) }, deletedAt: null },
        data: { deletedAt: new Date(), status: 'DISABLED', activePageId: null },
      });

      // ─── Analytics ───────────────────────────────────────────────────────
      // Regenerated each run so the charts always end today.
      await tx.tapEvent.deleteMany({ where: { companyId } });
      await tx.translationUsage.deleteMany({ where: { companyId } });

      const rand = mulberry32(20260927);
      const weighted = cardRows.map((c) => [c, c.weight] as [(typeof cardRows)[number], number]);
      const events: Prisma.TapEventCreateManyInput[] = [];
      const now = new Date();
      for (let daysAgo = DAYS - 1; daysAgo >= 0; daysAgo--) {
        const day = new Date(now);
        day.setUTCDate(day.getUTCDate() - daysAgo);
        // Gentle growth over the period, weekday pattern and some noise.
        const growth = 0.6 + 0.8 * ((DAYS - daysAgo) / DAYS);
        const count = Math.round(22 * growth * WEEKDAY[day.getUTCDay()] * (0.75 + rand() * 0.5));
        for (let i = 0; i < count; i++) {
          const card = pick(rand, weighted);
          const at = new Date(day);
          // Zurich is UTC+1/+2; UTC-1 hour is close enough for fake data.
          at.setUTCHours(pick(rand, HOURS) - 1, Math.floor(rand() * 60), Math.floor(rand() * 60), 0);
          if (at > now) continue;
          events.push({
            companyId,
            cardId: card.id,
            pageId: card.pageId,
            kind: card.kind,
            country: pick(rand, COUNTRIES),
            deviceType: pick(rand, DEVICES),
            referrer: null,
            createdAt: at,
          });
        }
      }
      await tx.tapEvent.createMany({ data: events });
      taps = events.length;

      // Wi-Fi guests who left their email (regenerated like the taps).
      await tx.wifiGuest.deleteMany({ where: { companyId } });
      const wifiPage = pageIds.get('taplino-demo-wifi')!;
      const guests: Prisma.WifiGuestCreateManyInput[] = [];
      for (let i = 0; i < GUEST_NAMES.length; i++) {
        const firstSeen = new Date(now.getTime() - Math.floor(rand() * DAYS) * 86_400_000);
        const lastSeen = new Date(
          firstSeen.getTime() + Math.floor(rand() * (now.getTime() - firstSeen.getTime())),
        );
        const consent = rand() < 0.45;
        guests.push({
          companyId,
          pageId: wifiPage.id,
          email: `${GUEST_NAMES[i]}@example.com`,
          locale: pick(rand, [['de', 70], ['en', 18], ['fr', 7], ['it', 5]]),
          verified: true,
          verifiedAt: firstSeen,
          marketingConsent: consent,
          consentAt: consent ? firstSeen : null,
          visits: 1 + Math.floor(rand() * rand() * 12),
          lastSeenAt: lastSeen,
          createdAt: firstSeen,
        });
      }
      await tx.wifiGuest.createMany({ data: guests });
    },
    { timeout: 60_000 },
  );

  /* eslint-disable no-console */
  console.log(`Demo business "${COMPANY.name}" ready: ${PAGES.length} pages, ${CARDS.length} cards, ${taps} taps.`);
  console.log(`  login  ${EMAIL}${process.env.DEMO_PASSWORD ? '' : ` / ${password}`}`);
  console.log(`  public /p/${PAGES[0].slug}`);
  /* eslint-enable no-console */
  await prisma.$disconnect();
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error(err);
  process.exit(1);
});
