-- Auditoria de pendencias de lancamento diario: override manual do operador
-- responsavel de uma pendencia (veiculo x dia), editado pelo ADM na tela de
-- Gestao de Pendencias. Idempotente.
CREATE TABLE IF NOT EXISTS "pendencias_parte_diaria_operador" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tag" VARCHAR(50) NOT NULL,
    "data" DATE NOT NULL,
    "operador_id" UUID,
    "operador_nome" VARCHAR(255),
    "operador_matricula" VARCHAR(50),
    "atualizado_por" VARCHAR(255),
    "created_at" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "pendencias_parte_diaria_operador_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "pendencias_parte_diaria_operador_tag_data_key"
  ON "pendencias_parte_diaria_operador"("tag", "data");

CREATE INDEX IF NOT EXISTS "pendencias_parte_diaria_operador_data_idx"
  ON "pendencias_parte_diaria_operador"("data");
