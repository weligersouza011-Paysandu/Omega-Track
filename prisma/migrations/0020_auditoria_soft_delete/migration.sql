-- Soft delete recuperavel (5 dias) para frota e partes diarias.
ALTER TABLE "mob_desmob" ADD COLUMN IF NOT EXISTS "deletado_em" TIMESTAMP(6);
ALTER TABLE "mob_desmob" ADD COLUMN IF NOT EXISTS "deletado_por" VARCHAR(255);
ALTER TABLE "partes_diarias" ADD COLUMN IF NOT EXISTS "deletado_em" TIMESTAMP(6);
ALTER TABLE "partes_diarias" ADD COLUMN IF NOT EXISTS "deletado_por" VARCHAR(255);

CREATE INDEX IF NOT EXISTS "mob_desmob_deletado_em_idx"
  ON "mob_desmob"("deletado_em");
CREATE INDEX IF NOT EXISTS "partes_diarias_deletado_em_idx"
  ON "partes_diarias"("deletado_em");

-- Trilha de auditoria global.
CREATE TABLE IF NOT EXISTS "logs_atividade" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "usuario_id" UUID,
    "nome_usuario" VARCHAR(255) NOT NULL,
    "funcao_usuario" VARCHAR(100),
    "acao" VARCHAR(100) NOT NULL,
    "modulo" VARCHAR(100) NOT NULL,
    "detalhes" JSONB,
    "ip_address" VARCHAR(100),
    "created_at" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "logs_atividade_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "logs_atividade_created_at_idx"
  ON "logs_atividade"("created_at");
CREATE INDEX IF NOT EXISTS "logs_atividade_usuario_id_idx"
  ON "logs_atividade"("usuario_id");
CREATE INDEX IF NOT EXISTS "logs_atividade_modulo_idx"
  ON "logs_atividade"("modulo");
CREATE INDEX IF NOT EXISTS "logs_atividade_acao_idx"
  ON "logs_atividade"("acao");
CREATE INDEX IF NOT EXISTS "logs_atividade_modulo_acao_idx"
  ON "logs_atividade"("modulo", "acao");

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'logs_atividade_usuario_id_fkey'
  ) THEN
    ALTER TABLE "logs_atividade"
      ADD CONSTRAINT "logs_atividade_usuario_id_fkey"
      FOREIGN KEY ("usuario_id") REFERENCES "usuarios"("id")
      ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;
