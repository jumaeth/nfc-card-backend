-- ─────────────────────────────────────────────────────────────────────────────
-- Row-Level Security: hard, database-enforced tenant isolation.
--
-- The application sets `app.current_user_id` (the authenticated user) on every
-- connection and drops into the restricted `taplino_app` role (SET LOCAL ROLE)
-- for tenant-scoped queries. These policies resolve which companies that user
-- may touch via CompanyMember and restrict every tenant table accordingly. A
-- query that forgets `companyId` can therefore only ever see the caller's own
-- tenants — Postgres enforces it, not the app.
-- ─────────────────────────────────────────────────────────────────────────────

-- The RLS-bound application role. NOLOGIN (never connected to directly) and
-- NOBYPASSRLS so policies apply. Idempotent.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'taplino_app') THEN
    CREATE ROLE taplino_app NOLOGIN NOBYPASSRLS NOSUPERUSER NOCREATEDB NOCREATEROLE;
  END IF;
END $$;

-- Set of company ids the current user may access: companies they are a member of.
-- SECURITY DEFINER so it reads membership regardless of RLS (avoids recursion
-- when a table's own policy calls it).
CREATE OR REPLACE FUNCTION app_accessible_company_ids()
RETURNS TABLE (company_id text)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT cm."companyId"
  FROM "CompanyMember" cm
  WHERE cm."userId" = NULLIF(current_setting('app.current_user_id', true), '');
$$;

-- Server-only escape hatch for trusted bootstrap / unauthenticated writes
-- (PrismaService.$asAdmin). Never derived from user input.
CREATE OR REPLACE FUNCTION app_rls_bypass()
RETURNS boolean
LANGUAGE sql
STABLE
AS $$
  SELECT current_setting('app.bypass_rls', true) = 'on';
$$;

CREATE OR REPLACE FUNCTION app_can_access_company(cid text)
RETURNS boolean
LANGUAGE sql
STABLE
AS $$
  SELECT app_rls_bypass()
      OR cid IN (SELECT company_id FROM app_accessible_company_ids());
$$;

-- ─── Simple company-scoped tables (single policy over all commands) ──────────
DO $$
DECLARE
  t text;
  tables text[] := ARRAY[
    'CompanySettings', 'Location', 'Card', 'Page', 'TapEvent',
    'Subscription', 'StripeCustomer', 'Invitation'
  ];
BEGIN
  FOREACH t IN ARRAY tables LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY;', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY;', t);
    EXECUTE format(
      'CREATE POLICY tenant_isolation ON %I '
      'USING (app_can_access_company("companyId")) '
      'WITH CHECK (app_can_access_company("companyId"));', t);
  END LOOP;
END $$;

-- ─── Company: readable/updatable only by members; any authenticated user may
--     create one (they become owner immediately after). ────────────────────────
ALTER TABLE "Company" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Company" FORCE ROW LEVEL SECURITY;
CREATE POLICY company_select ON "Company" FOR SELECT
  USING (app_rls_bypass() OR id IN (SELECT company_id FROM app_accessible_company_ids()));
CREATE POLICY company_update ON "Company" FOR UPDATE
  USING (app_rls_bypass() OR id IN (SELECT company_id FROM app_accessible_company_ids()))
  WITH CHECK (app_rls_bypass() OR id IN (SELECT company_id FROM app_accessible_company_ids()));
CREATE POLICY company_delete ON "Company" FOR DELETE
  USING (app_rls_bypass() OR id IN (SELECT company_id FROM app_accessible_company_ids()));
CREATE POLICY company_insert ON "Company" FOR INSERT
  WITH CHECK (
    app_rls_bypass()
    OR NULLIF(current_setting('app.current_user_id', true), '') IS NOT NULL
  );

-- ─── CompanyMember: a user always sees their own memberships (needed to list
--     their companies) plus co-members of companies they can access. ───────────
ALTER TABLE "CompanyMember" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "CompanyMember" FORCE ROW LEVEL SECURITY;
CREATE POLICY member_isolation ON "CompanyMember"
  USING (
    app_rls_bypass()
    OR "userId" = NULLIF(current_setting('app.current_user_id', true), '')
    OR "companyId" IN (SELECT company_id FROM app_accessible_company_ids())
  )
  WITH CHECK (
    app_rls_bypass()
    OR "userId" = NULLIF(current_setting('app.current_user_id', true), '')
    OR "companyId" IN (SELECT company_id FROM app_accessible_company_ids())
  );

-- NOTE (intentionally NOT row-level-secured):
--   User, Session, Account, Verification, Passkey → auth/identity (better-auth)
--   SubscriptionPlan                              → global price catalogue

-- ─── Grants for the app role ─────────────────────────────────────────────────
GRANT USAGE ON SCHEMA public TO taplino_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO taplino_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO taplino_app;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO taplino_app;

ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO taplino_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT USAGE, SELECT ON SEQUENCES TO taplino_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT EXECUTE ON FUNCTIONS TO taplino_app;
