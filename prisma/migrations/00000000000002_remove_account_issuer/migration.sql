-- Align Account with stock better-auth (1.7.5): it does not set `issuer`.
ALTER TABLE "Account" DROP COLUMN IF EXISTS "issuer";
