import { PrismaClient } from '../../generated/prisma/client.js';
import { getTenantUserId } from './tenant-context.js';

type Client = InstanceType<typeof PrismaClient>;

/**
 * The database role the application drops into for tenant-scoped queries. It is
 * NOLOGIN and NOBYPASSRLS (created by the RLS migration), so row-level security
 * applies to it. The app connects as the owner/superuser but `SET LOCAL ROLE`s
 * into this role per query — so RLS turns on automatically once the migration
 * has run, with no separate connection, password, or env var.
 */
export const APP_ROLE = 'taplino_app';

/**
 * Wraps a base PrismaClient so every operation carries the current request's
 * tenant context into Postgres for row-level security.
 *
 * Both the session variable and `SET LOCAL ROLE` are transaction-scoped and must
 * run on the SAME connection as the query, so each operation is executed as one
 * batch transaction:
 *
 *   BEGIN;
 *   SELECT set_config('app.current_user_id', $1, true);  -- as owner
 *   SET LOCAL ROLE taplino_app;                            -- drop to RLS-bound role
 *   <the query>;                                          -- runs under RLS
 *   COMMIT;                                               -- role + var reset
 *
 * The batch is issued on the BASE client (not the extended one) so the raw
 * statements do not re-enter this extension (which would recurse). `query(args)`
 * placed in the same `$transaction([...])` array runs on that connection.
 *
 * With no tenant context (unauthenticated routes, health checks) the operation
 * runs as-is — as the owner, but reading only non-RLS tables in practice.
 *
 * NOTE: interactive transactions (PrismaService.$transaction) apply the same two
 * statements themselves and run on the base client, which this extension does
 * not intercept — so there is no double-wrapping.
 */
export function withRls(base: Client): Client {
  const extended = base.$extends({
    query: {
      async $allOperations({ args, query }) {
        const userId = getTenantUserId();
        if (!userId) return query(args);
        const [, , result] = await base.$transaction([
          base.$executeRaw`SELECT set_config('app.current_user_id', ${userId}, true)`,
          // APP_ROLE is a fixed constant (never user input) — safe as raw SQL;
          // role names cannot be parameterized.
          base.$executeRawUnsafe(`SET LOCAL ROLE ${APP_ROLE}`),
          query(args),
        ]);
        return result;
      },
    },
  });
  // The extended client is structurally the base client to callers — same models
  // and result shapes; the extension only stamps the RLS session variable. Typing
  // it as Client keeps full query-result types (the $allOperations wrapper would
  // otherwise widen every result to `unknown`).
  return extended as unknown as Client;
}
