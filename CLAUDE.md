# Taplino backend conventions

- **ESM only.** `"type": "module"`, `tsconfig` is `nodenext`. Every relative import
  ends in `.js`. Prisma model/enum types are imported with `import type`.
- **Multi-tenancy is database-enforced.** Never bypass `PrismaService` for tenant
  data. Every service takes an explicit `companyId` and calls `CompanyAccessService`
  (`requireMember` for reads, `requireManager`/`requireRole` for writes) before
  touching data. RLS is the backstop, not the only line of defense.
- **`$asAdmin` / raw `$prisma` are the only RLS escape hatches** (bootstrap a new
  company, or serve unauthenticated public tap pages). Use sparingly and scope
  explicitly.
- **Logging:** use `log/warn/error` + `LogKey` from `src/logger/`. Add new keys to
  `src/logger/keys.ts`. Do not use `console.log`.
- **Copy:** never use the em dash character in user-facing strings (emails, API
  messages). Use a period or comma.
- **Git:** never commit or push unless explicitly asked in the current request.
