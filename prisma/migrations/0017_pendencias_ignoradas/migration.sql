-- Auditoria de pendencias de lancamento diario: descarte manual de
-- pendencia (veiculo x dia) por ADM/Transporte. Idempotente.
CREATE TABLE IF NOT EXISTS "pendencias_parte_diaria_ignoradas" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tag" VARCHAR(50) NOT NULL,
    "data" DATE NOT NULL,
    "motivo" VARCHAR(255),
    "ignorado_por" VARCHAR(255),
    "created_at" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "pendencias_parte_diaria_ignoradas_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "pendencias_parte_diaria_ignoradas_tag_data_key"
  ON "pendencias_parte_diaria_ignoradas"("tag", "data");

CREATE INDEX IF NOT EXISTS "pendencias_parte_diaria_ignoradas_data_idx"
  ON "pendencias_parte_diaria_ignoradas"("data");
