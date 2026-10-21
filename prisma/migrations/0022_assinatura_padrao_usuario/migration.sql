-- AlterTable
ALTER TABLE "usuarios" ADD COLUMN "assinatura_padrao" TEXT;

-- Backfill: a assinatura já cadastrada passa a ser a assinatura padrão.
UPDATE "usuarios"
SET "assinatura_padrao" = "assinatura_url"
WHERE "assinatura_padrao" IS NULL AND "assinatura_url" IS NOT NULL;
