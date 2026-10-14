-- AlterTable usuarios
ALTER TABLE "usuarios" ADD COLUMN IF NOT EXISTS "assinatura_url" TEXT;

-- Suporte retroativo caso tabela users exista
DO $$ BEGIN
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'users') THEN
        ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "assinatura_url" TEXT;
    END IF;
END $$;

-- AlterTable partes_diarias
ALTER TABLE "partes_diarias" ADD COLUMN IF NOT EXISTS "status_operacional" VARCHAR(50) NOT NULL DEFAULT 'Operação';
ALTER TABLE "partes_diarias" ADD COLUMN IF NOT EXISTS "status_aprovacao" VARCHAR(50) NOT NULL DEFAULT 'Em Preenchimento';

-- Backfill de status existentes
UPDATE "partes_diarias"
SET "status_operacional" = CASE
    WHEN "status" IN ('Operação', 'Manutenção Corretiva', 'Manutenção Preventiva', 'Indisponibilidade', 'Interdição') THEN "status"
    WHEN "status" = 'Operacional' THEN 'Operação'
    WHEN "status" = 'Em Manutencao' THEN 'Manutenção Corretiva'
    WHEN "status" = 'Interditado' THEN 'Interdição'
    ELSE 'Operação'
END
WHERE "status_operacional" IS NULL OR "status_operacional" = 'Operação';

UPDATE "partes_diarias"
SET "status_aprovacao" = CASE
    WHEN "status_relatorio" = 'APROVADO' THEN 'Aprovado'
    WHEN "status_relatorio" = 'REVISAO' THEN 'Revisado pelo Transporte'
    ELSE 'Em Preenchimento'
END
WHERE "status_aprovacao" IS NULL OR "status_aprovacao" = 'Em Preenchimento';

-- CreateIndex
CREATE INDEX IF NOT EXISTS "partes_diarias_status_operacional_idx" ON "partes_diarias"("status_operacional");
CREATE INDEX IF NOT EXISTS "partes_diarias_status_aprovacao_idx" ON "partes_diarias"("status_aprovacao");
