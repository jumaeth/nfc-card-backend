-- Taplino rebranded from orange to blue. New companies default to the blue
-- accent, and companies still on the old orange default move to blue too.
ALTER TABLE "Company" ALTER COLUMN "brandColor" SET DEFAULT '#2f6df0';

-- "Company" has FORCE ROW LEVEL SECURITY, so without the bypass flag this
-- update would silently match no rows. set_config(..., true) scopes it to
-- this migration's transaction.
SELECT set_config('app.bypass_rls', 'on', true);
UPDATE "Company" SET "brandColor" = '#2f6df0' WHERE lower("brandColor") = '#f0431f';
